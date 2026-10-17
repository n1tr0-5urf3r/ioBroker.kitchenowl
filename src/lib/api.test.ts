import { expect } from 'chai';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { EXPENSE_PAGE_SIZE, HEALTH_PATH, KitchenOwlApiError, KitchenOwlClient } from './api';
import { ExpenseFrame, ExpenseView } from './types';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Records what the mock server saw, so assertions can check the wire format. */
interface Recorded {
	method: string;
	url: string;
	authorization?: string;
	body: string;
}

describe('KitchenOwlClient', () => {
	let server: Server;
	let baseUrl: string;
	let handler: Handler;
	let requests: Recorded[];

	beforeEach(async () => {
		requests = [];
		handler = (_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{}');
		};

		server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', chunk => chunks.push(chunk as Buffer));
			req.on('end', () => {
				requests.push({
					method: req.method ?? '',
					url: req.url ?? '',
					authorization: req.headers.authorization,
					body: Buffer.concat(chunks).toString(),
				});
				handler(req, res);
			});
		});

		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		await new Promise<void>(resolve => server.close(() => resolve()));
	});

	const client = (overrides: Record<string, unknown> = {}): KitchenOwlClient =>
		new KitchenOwlClient({ url: baseUrl, token: 'test-token', timeout: 1000, retries: 0, ...overrides });

	const respondJson = (payload: unknown, status = 200): void => {
		handler = (_req, res) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(payload));
		};
	};

	it('sends the bearer token on authenticated calls', async () => {
		respondJson([]);
		await client().households();

		expect(requests).to.have.lengthOf(1);
		expect(requests[0].url).to.equal('/api/household');
		expect(requests[0].authorization).to.equal('Bearer test-token');
	});

	it('omits the token on the health endpoint, which takes none', async () => {
		respondJson({ msg: 'OK', version: 124, min_frontend_version: 71 });
		const health = await client().health();

		expect(requests[0].url).to.equal(HEALTH_PATH);
		expect(requests[0].authorization).to.equal(undefined);
		expect(health.version).to.equal(124);
	});

	it('strips a trailing slash from the configured URL', async () => {
		respondJson([]);
		await client({ url: `${baseUrl}///` }).households();

		expect(requests[0].url).to.equal('/api/household');
	});

	it('strips a trailing /api, which KitchenOwl appends itself', async () => {
		respondJson([]);
		await client({ url: `${baseUrl}/api/` }).households();

		expect(requests[0].url).to.equal('/api/household');
	});

	it('builds absolute photo URLs', () => {
		expect(client().photoUrl('a b.jpg')).to.equal(`${baseUrl}/api/upload/a%20b.jpg`);
	});

	describe('error handling', () => {
		it('raises a typed error carrying the status code', async () => {
			handler = (_req, res) => {
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('Requested resource not found');
			};

			const error = await client()
				.households()
				.catch((e: unknown) => e);

			expect(error).to.be.instanceOf(KitchenOwlApiError);
			expect((error as KitchenOwlApiError).status).to.equal(404);
			expect((error as KitchenOwlApiError).message).to.contain('Requested resource not found');
		});

		it('flags authentication failures so the adapter can say so plainly', async () => {
			handler = (_req, res) => {
				res.writeHead(401);
				res.end('Request unauthorized');
			};

			const error = (await client()
				.households()
				.catch((e: unknown) => e)) as KitchenOwlApiError;

			expect(error.isAuthError).to.equal(true);
		});

		it('does not retry client errors, because they will not fix themselves', async () => {
			handler = (_req, res) => {
				res.writeHead(401);
				res.end('Request unauthorized');
			};

			await client({ retries: 3, retryDelay: 1 })
				.households()
				.catch(() => undefined);

			expect(requests).to.have.lengthOf(1);
		});

		it('retries server errors and succeeds on a later attempt', async () => {
			let attempt = 0;
			handler = (_req, res) => {
				attempt++;
				if (attempt < 3) {
					res.writeHead(500);
					res.end('Something went wrong');
					return;
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('[{"id":1,"name":"Example Household"}]');
			};

			const households = await client({ retries: 3, retryDelay: 1 }).households();

			expect(requests).to.have.lengthOf(3);
			expect(households[0].name).to.equal('Example Household');
		});

		it('gives up after the configured number of retries', async () => {
			handler = (_req, res) => {
				res.writeHead(500);
				res.end('Something went wrong');
			};

			await client({ retries: 2, retryDelay: 1 })
				.households()
				.catch(() => undefined);

			// One initial attempt plus two retries.
			expect(requests).to.have.lengthOf(3);
		});

		it('reports a body that is not JSON instead of throwing a parse error', async () => {
			handler = (_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('<html>not json</html>');
			};

			const error = (await client()
				.households()
				.catch((e: unknown) => e)) as Error;

			expect(error.message).to.contain('not valid JSON');
		});

		it('times out a request that never answers, and says so', async () => {
			handler = () => {
				// Never respond; the client's own timeout has to fire.
			};

			const error = (await client({ timeout: 150 })
				.households()
				.catch((e: unknown) => e)) as Error;

			expect(error).to.be.instanceOf(Error);
			// "This operation was aborted" would tell nobody what went wrong.
			expect(error.message).to.contain('timed out after 150 ms');
		});

		it('retries a rate limit, which passes on its own', async () => {
			let attempts = 0;
			handler = (_req, res) => {
				attempts++;
				if (attempts === 1) {
					res.writeHead(429, { 'Content-Type': 'text/plain' });
					res.end('Too Many Requests');
					return;
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end('[]');
			};

			const households = await client({ retries: 2, retryDelay: 1 }).households();

			expect(attempts).to.equal(2);
			expect(households).to.deep.equal([]);
		});

		it('refuses to issue requests after being destroyed', async () => {
			const instance = client();
			await instance.destroy();

			const error = (await instance.households().catch((e: unknown) => e)) as Error;

			expect(error.message).to.contain('destroyed');
			expect(requests).to.be.empty;
		});
	});

	describe('expense paging', () => {
		/**
		 * Builds a full page so the client believes more data may follow.
		 *
		 * @param startId - Id of the newest expense in the page
		 */
		const fullPage = (startId: number): unknown[] =>
			Array.from({ length: EXPENSE_PAGE_SIZE }, (_, index) => ({
				id: startId - index,
				name: `Expense ${startId - index}`,
				amount: 1,
				household_id: 1,
				paid_by_id: 1,
			}));

		it('stops after a short page', async () => {
			respondJson([{ id: 5, name: 'Only one', amount: 1, household_id: 1, paid_by_id: 1 }]);

			const expenses = await client().expenses(1, ExpenseView.Household, 5);

			expect(expenses).to.have.lengthOf(1);
			expect(requests).to.have.lengthOf(1);
			expect(requests[0].url).to.equal('/api/household/1/expense?view=0');
		});

		it('follows the cursor while pages come back full', async () => {
			let page = 0;
			handler = (_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(page++ === 0 ? fullPage(100) : fullPage(70).slice(0, 4)));
			};

			const expenses = await client().expenses(1, ExpenseView.Personal, 3);

			expect(expenses).to.have.lengthOf(EXPENSE_PAGE_SIZE + 4);
			expect(requests).to.have.lengthOf(2);
			expect(requests[0].url).to.equal('/api/household/1/expense?view=1');
			// The cursor is the last id of the previous page.
			expect(requests[1].url).to.equal('/api/household/1/expense?view=1&startAfterId=71');
		});

		it('never fetches more pages than requested', async () => {
			respondJson(fullPage(100));

			await client().expenses(1, ExpenseView.Household, 2);

			expect(requests).to.have.lengthOf(2);
		});
	});

	describe('expense overview', () => {
		it('passes the frame, steps and view through', async () => {
			respondJson({});
			await client().expenseOverview(1, ExpenseFrame.Yearly, 3, ExpenseView.Personal);

			expect(requests[0].url).to.equal('/api/household/1/expense/overview?frame=3&steps=3&view=1');
		});

		it('clamps an out-of-range frame, which the server answers with a 500', async () => {
			respondJson({});
			await client().expenseOverview(1, 9 as ExpenseFrame, 5, ExpenseView.Household);

			expect(requests[0].url).to.contain('frame=2');
		});
	});

	describe('writes', () => {
		it('adds a shopping list item by name', async () => {
			respondJson({});
			await client().addShoppingListItemByName(2, 'Bread', '2 loaves');

			expect(requests[0].method).to.equal('POST');
			expect(requests[0].url).to.equal('/api/shoppinglist/2/add-item-by-name');
			expect(JSON.parse(requests[0].body)).to.deep.equal({ name: 'Bread', description: '2 loaves' });
		});

		it('removes a shopping list item by id', async () => {
			respondJson({});
			await client().removeShoppingListItem(2, 10);

			expect(requests[0].method).to.equal('DELETE');
			expect(requests[0].url).to.equal('/api/shoppinglist/2/item');
			expect(JSON.parse(requests[0].body)).to.deep.equal({ item_id: 10 });
		});

		it('names the planning to remove by its cooking date, in the body', async () => {
			respondJson({});
			await client().removePlannedRecipe(1, 3, 1792368000000);

			// The server validates everything but GET against the request body,
			// so a query parameter here is simply not read.
			expect(requests[0].method).to.equal('DELETE');
			expect(requests[0].url).to.equal('/api/household/1/planner/recipe/3');
			expect(JSON.parse(requests[0].body)).to.deep.equal({ cooking_date: 1792368000000 });
		});

		it('still sends a body when the planning has no date', async () => {
			respondJson({});
			await client().removePlannedRecipe(1, 3);

			// An empty body makes the server's argument parsing raise, so even
			// "no arguments" has to be sent as {}.
			expect(requests[0].body).to.equal('{}');
		});

		it('sends a body when deleting an expense', async () => {
			respondJson({});
			await client().deleteExpense(530);

			expect(requests[0].method).to.equal('DELETE');
			expect(requests[0].body).to.equal('{}');
		});

		it('never sends a bodyless request with a method other than GET', async () => {
			respondJson([]);
			const c = client();
			await c.addShoppingListItemByName(2, 'Bread');
			await c.removeShoppingListItem(2, 10);
			await c.clearShoppingList(2);
			await c.updateShoppingListItemDescription(2, 10, '1 kg');
			await c.deleteExpense(530);
			await c.removePlannedRecipe(1, 3, 1792368000000);
			await c.addPlannedRecipe(1, { recipe_id: 3 });

			const offenders = requests.filter(r => r.method !== 'GET' && r.body === '');
			expect(offenders.map(r => `${r.method} ${r.url}`)).to.be.empty;
		});

		it('escapes the URL when importing a recipe', async () => {
			respondJson({});
			await client().scrapeRecipe(1, 'https://example.invalid/a b?x=1');

			expect(requests[0].url).to.equal(
				'/api/household/1/recipe/scrape?url=https%3A%2F%2Fexample.invalid%2Fa+b%3Fx%3D1',
			);
		});

		it('accepts an empty response body', async () => {
			handler = (_req, res) => {
				res.writeHead(200);
				res.end();
			};

			const result = await client().removeShoppingListItem(2, 10);

			expect(result).to.equal(undefined);
		});

		it('clears a list by naming every item currently on it', async () => {
			// The endpoint deletes the items it is handed; with no body its handler
			// reads a missing key and answers 500.
			handler = (req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(
					req.method === 'GET'
						? '[{"id":10,"name":"Bread","household_id":1},{"id":11,"name":"Milk","household_id":1}]'
						: '{}',
				);
			};

			await client().clearShoppingList(2);

			expect(requests.map(r => `${r.method} ${r.url}`)).to.deep.equal([
				'GET /api/shoppinglist/2/items',
				'DELETE /api/shoppinglist/2/items',
			]);
			expect(JSON.parse(requests[1].body)).to.deep.equal({ items: [{ item_id: 10 }, { item_id: 11 }] });
		});

		it('does not call the delete at all for a list that is already empty', async () => {
			respondJson([]);

			await client().clearShoppingList(2);

			expect(requests.map(r => r.method)).to.deep.equal(['GET']);
		});
	});
});
