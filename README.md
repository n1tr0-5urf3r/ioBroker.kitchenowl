<p align="center">
  <img src="admin/kitchenowl.png" alt="KitchenOwl" width="120" />
</p>

# ioBroker.kitchenowl

<p align="center">
  Bring your self-hosted <a href="https://kitchenowl.org/">KitchenOwl</a> kitchen into ioBroker.
</p>

<p align="center">
  <a href="https://github.com/n1tr0-5urf3r/ioBroker.kitchenowl/actions/workflows/test-and-release.yml"><img src="https://github.com/n1tr0-5urf3r/ioBroker.kitchenowl/actions/workflows/test-and-release.yml/badge.svg?branch=main" alt="Test and Release" /></a>
  <a href="https://www.npmjs.com/package/iobroker.kitchenowl"><img src="https://img.shields.io/npm/v/iobroker.kitchenowl.svg" alt="NPM version" /></a>
  <a href="https://www.npmjs.com/package/iobroker.kitchenowl"><img src="https://img.shields.io/npm/dm/iobroker.kitchenowl.svg" alt="Downloads" /></a>
  <img src="https://iobroker.live/badges/kitchenowl-installed.svg" alt="Number of installations" />
  <img src="https://iobroker.live/badges/kitchenowl-stable.svg" alt="Current version in stable repository" />
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/iobroker.kitchenowl.svg" alt="License" /></a>
</p>

## Features

- **Shopping lists** — every list with its items, a comma-separated text summary for notifications, and recently
  removed items
- **Meal planner** — one branch per weekday plus the next planned meal, ready for a dashboard or a voice prompt
- **Recipes** — ingredients, times, servings, tags, source and photo, per recipe or as one JSON state
- **Expenses** — recent bookings, per-category spending and a daily/weekly/monthly/yearly statistics overview
- **Members and balances** — who owes what, rounded and ready to display
- **Item catalog** — all known items, categories and tags
- **Write back** — add and tick off shopping list items, book expenses, plan recipes, import a recipe from a URL
- **Multi-household** — synchronize one, several or all households a token can see
- **German and English** throughout, in the admin UI and in the object tree

Everything above can be switched off individually, and write access is off by default.

<details>
<summary><b>About KitchenOwl, compatibility and disclaimer</b></summary>

KitchenOwl is a free, self-hosted grocery list and recipe manager. The project lives at
[github.com/TomBursch/kitchenowl](https://github.com/TomBursch/kitchenowl) and is licensed under the AGPL-3.0.

Tested against KitchenOwl v0.7.10 (backend version 124). Household-scoped API paths have been stable since backend
version 57, so v0.4 and newer should work; the adapter reads the server version at startup and writes it to
`info.serverVersion`.

**Disclaimer:** this adapter is an independent project and is not affiliated with, endorsed by, or supported by the
KitchenOwl project or its authors. The KitchenOwl name and logo belong to their respective owners; the logo is used
here only to identify the service this adapter connects to.

</details>

## Getting started

1. Install the adapter and create an instance.
2. In KitchenOwl, create a long-lived API token: open your profile, go to **Sessions** and add a long-lived token.
3. Enter the base URL of your server (for example `https://kitchenowl.example.com`) and the token on the
   **Connection** tab, then press **Test connection**. The adapter appends `/api` itself, and strips a trailing
   `/api` if you enter one anyway.
4. On the **Households and sync** tab, pick the households to synchronize. Leaving the field empty synchronizes every
   household the token can see.

The token belongs to a user, not to a household, and grants everything that user can do in every household they are a
member of. It does not expire until you revoke it in KitchenOwl.

<details>
<summary><b>All settings</b></summary>

### Connection

| Setting | Default | Description |
| --- | --- | --- |
| Server URL | — | Base URL of the instance, without `/api` |
| API token | — | Long-lived token; stored encrypted in the instance configuration |
| Request timeout | 10000 ms | How long a single request may take |
| Retries per request | 2 | Server and network errors are retried; 4xx responses are not |
| Delay between retries | 2000 ms | Grows linearly with the attempt number |
| Verify TLS certificate | on | Turn off only for a self-signed certificate |

### Households and sync

| Setting | Default | Description |
| --- | --- | --- |
| Households to synchronize | all | Empty means every household visible to the token |
| Poll interval | 300 s | Minimum 30 s |
| Members and expense balances | on | |
| Shopping lists | on | |
| Recipes | on | |
| Meal planner | on | Skipped for households with the planner feature disabled |
| Expenses | on | Skipped for households with the expenses feature disabled |
| Item catalog, categories and tags | off | Can be several hundred entries per household |
| Create a state tree per recipe | on | Off leaves only the `recipes.json` state |
| Create a state tree per shopping list item | on | Off leaves only the per-list `json` state |
| Delete objects that disappeared in KitchenOwl | on | Prunes states for removed lists, recipes and members |

### Expenses

| Setting | Default | Description |
| --- | --- | --- |
| Perspective | Whole household | Personal reports only your share of each expense |
| Pages of recent expenses | 1 | The server returns 30 expenses per page |
| Time frame | Monthly | Bucket size of the statistics overview |
| Number of periods | 5 | How many periods the overview covers, including the current one |

### Write access

Off by default. When enabled, the adapter creates additional writable states and buttons; see the
**Writing back to KitchenOwl** section below.

</details>

<details>
<summary><b>Object tree</b></summary>

```
kitchenowl.<instance>
├── info
│   ├── connection              adapter reached the server on the last poll
│   ├── lastUpdate              timestamp of the last successful poll
│   ├── lastError               message of the last failure, empty when healthy
│   ├── serverVersion           KitchenOwl backend version
│   └── minFrontendVersion      minimum frontend version the server expects
├── commands
│   └── refresh                 button, polls immediately
└── households.<id>
    ├── name, description, language, photoUrl, viewOrdering
    ├── expensesFeature, plannerFeature, defaultShoppingListId
    ├── members
    │   ├── count, balancesJson
    │   └── <username>          id, name, username, balance, isHouseholdAdmin,
    │                           isOwner, lastSeen, photoUrl
    ├── shoppingLists
    │   ├── count, json
    │   └── <listId>            name, itemCount, itemNames, json, recentItemsJson
    │       └── items.<itemId>  name, category, icon, description
    ├── recipes
    │   ├── count, json
    │   └── <recipeId>          name, description, time, prepTime, cookTime,
    │                           yields, source, photoUrl, tags, planned,
    │                           plannedDays, visibility, itemsJson
    ├── planner
    │   ├── count, json, nextRecipeName, nextRecipeId, nextCookingDate
    │   └── days.<0-6>          date, recipeId, recipeName, yields
    ├── expenses
    │   ├── count, recentJson, overviewJson, currentPeriodTotal
    │   ├── newestName, newestAmount, newestDate, newestPaidBy
    │   └── categories.<id>     name, budget, color, currentPeriodSum
    │       └── uncategorized   currentPeriodSum for expenses with no category
    └── catalog
        └── itemsJson, itemCount, categoriesJson, categoryCount, tagsJson, tagCount
```

Weekday `0` is Monday. Timestamps are epoch milliseconds, matching what the KitchenOwl API returns. A date that is
not set reads as empty rather than as epoch 0. Expense balances are rounded to two decimals; the API returns them as
raw floats.

Renaming a list, recipe, member or category in KitchenOwl renames the matching channel in the object tree. A name you
edit yourself in the admin UI survives a restart of the adapter, because after a restart there is no telling your
rename apart from one made upstream.

</details>

<details>
<summary><b>Writing back to KitchenOwl</b></summary>

Enable **Write access** to get these additional states. Writing to one of them sends the change to KitchenOwl and then
re-reads the affected household.

| State | Type | Effect |
| --- | --- | --- |
| `households.<id>.shoppingLists.<listId>.addItemByName` | string | Adds an item to the list. Plain text is the name; JSON sets the description too, e.g. `{"name": "Milk", "description": "2 L"}` |
| `households.<id>.shoppingLists.<listId>.clear` | button | Removes every item from the list |
| `households.<id>.shoppingLists.<listId>.items.<itemId>.remove` | button | Removes that item from the list |
| `households.<id>.shoppingLists.<listId>.items.<itemId>.description` | string | Changes the item description, for example the amount |
| `households.<id>.expenses.add` | JSON | Books an expense. `name`, `amount`, `paid_by` and `paid_for` are all required, e.g. `{"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}, {"id": 2}]}` |
| `households.<id>.expenses.recalculateBalances` | button | Asks the server to recompute member balances |
| `households.<id>.planner.addRecipe` | JSON | Plans a recipe, e.g. `{"recipe_id": 20, "cooking_date": 1700000000000}` |
| `households.<id>.planner.days.<0-6>.remove` | button | Removes the meal planned on that weekday |
| `households.<id>.recipes.scrapeUrl` | string | Imports a recipe from a URL; the scraped recipe lands in `recipes.scrapeResult` as JSON |

### Messages

The instance also answers `sendTo` messages, which is handy from scripts:

```javascript
sendTo('kitchenowl.0', 'getHouseholds', {}, result => log(JSON.stringify(result)));
sendTo('kitchenowl.0', 'testConnection', {}, result => log(JSON.stringify(result)));
sendTo('kitchenowl.0', 'refresh', {}, result => log(JSON.stringify(result)));
```

</details>

<details>
<summary><b>Troubleshooting</b></summary>

- **`info.connection` stays false** — check `info.lastError`. A rejected token is reported explicitly; the adapter keeps
  retrying rather than stopping.
- **The household dropdown stays empty** — the admin UI asks the running instance for the list, so the URL and token
  have to be valid. Use **Test connection** to see the exact error.
- **A household has no expenses or planner branch** — those features are enabled per household inside KitchenOwl, and
  the adapter mirrors that.
- **Self-signed certificate** — turn off **Verify TLS certificate** on the Connection tab.
- **One household is missing from the tree** — a household the adapter cannot read is logged as a warning and the
  other households are still updated; `info.lastError` names it. Nothing is deleted from the tree while that lasts.

</details>

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 0.0.4 (2026-10-17)

- (n1tr0-5urf3r) Removing a planned meal names the date it refers to, so the right one goes when a recipe is on the plan more than once, and pressing remove on an empty day does nothing instead of logging an error
- (n1tr0-5urf3r) Clearing a shopping list names the items to remove, which is what the endpoint expects; it answered with an error before
- (n1tr0-5urf3r) Adding an expense documents and checks the fields the server actually requires: `paid_by` and `paid_for` are objects, and there is no `paid_by_id`
- (n1tr0-5urf3r) Removed the id states whose value was already the name of the object they sat in
- (n1tr0-5urf3r) A date that is not set now reads as empty instead of 1 January 1970
- (n1tr0-5urf3r) Expenses name the person who paid instead of exposing a numeric user id
- (n1tr0-5urf3r) Expense category colours are CSS values, and recipe visibility shows a label
- (n1tr0-5urf3r) Existing objects are kept in line with the adapter's own definitions, so enabling write access makes the states that are already there writable rather than only the ones created afterwards
- (n1tr0-5urf3r) A shopping list, recipe, member or category renamed in KitchenOwl is renamed in the object tree as well
- (n1tr0-5urf3r) Names that come from KitchenOwl are no longer run through the German name table, so a list called "Items" keeps its name
- (n1tr0-5urf3r) The result of a recipe import reaches `recipes.scrapeResult` instead of being thrown away and the state wiped on the next poll
- (n1tr0-5urf3r) The next planned meal skips days that are already over
- (n1tr0-5urf3r) One household that cannot be read no longer costs every other household its update
- (n1tr0-5urf3r) A refresh requested while a poll is running is carried out afterwards instead of being dropped, and the refresh button is acknowledged
- (n1tr0-5urf3r) Shopping list items can be added with a description by writing JSON instead of a plain name
- (n1tr0-5urf3r) A server URL entered with a trailing `/api` is accepted, a request that times out says so instead of reporting an aborted operation, and a rate limited request is retried
- (n1tr0-5urf3r) Two members whose usernames differ only in punctuation no longer share one branch
- (n1tr0-5urf3r) `getHouseholds` over the message box keeps the configured TLS setting and no longer leaks its connection when it fails
- (n1tr0-5urf3r) The object database is only read back when a definition actually changed, which takes around a thousand lookups per household out of every poll

### 0.0.3 (2026-10-17)

- (n1tr0-5urf3r) The item payloads no longer repeat the full category object and KitchenOwl's internal bookkeeping, which cuts the catalog state of a 800 item household from roughly 290 kB to 56 kB
- (n1tr0-5urf3r) Removed the household json state, which only repeated the states next to it

### 0.0.2 (2026-10-17)

- (n1tr0-5urf3r) Fixed a retry delay that was not cancelled when the adapter shut down
- (n1tr0-5urf3r) The compiled output is part of the repository again, so installing from a GitHub URL works
- (n1tr0-5urf3r) Translated the admin interface into the remaining languages
- (n1tr0-5urf3r) Raised the requirements to Node.js 22.19 and admin 7.6.20
- (n1tr0-5urf3r) Releases are published automatically from CI

### 0.0.1 (2026-10-17)

- (n1tr0-5urf3r) initial release

## License

MIT License

Copyright (c) 2026 n1tr0-5urf3r <fabi@ihlecloud.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
