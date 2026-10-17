/**
 * German names for the states and channels the adapter creates.
 *
 * ioBroker renders `common.name` per user language, so every static name goes
 * through here. Names that come from KitchenOwl itself, such as a household or
 * recipe title, are passed through untranslated.
 */
const GERMAN: Record<string, string> = {
	Colour: 'Farbe',
	'Newest expense paid by': 'Neueste Ausgabe bezahlt von',
	'Adapter commands': 'Adapterbefehle',
	'Add an expense, as JSON: {"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}]}':
		'Ausgabe anlegen, als JSON: {"name": "Einkauf", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}]}',
	'Add an item by name, or as JSON: {"name": "Milk", "description": "2 L"}':
		'Artikel hinzufügen, über den Namen oder als JSON: {"name": "Milch", "description": "2 l"}',
	'All item categories': 'Alle Artikelkategorien',
	'All items on the list': 'Alle Artikel auf der Liste',
	'All known items': 'Alle bekannten Artikel',
	'All recipe tags': 'Alle Rezept-Schlagwörter',
	'All shopping lists': 'Alle Einkaufslisten',
	Budget: 'Budget',
	Category: 'Kategorie',
	'Configured view order': 'Konfigurierte Ansichtsreihenfolge',
	'Cooking date': 'Kochdatum',
	'Cooking time': 'Garzeit',
	'Currently planned': 'Aktuell eingeplant',
	'Default shopping list ID': 'ID der Standard-Einkaufsliste',
	Description: 'Beschreibung',
	'Description, for example the amount': 'Beschreibung, zum Beispiel die Menge',
	'Display name': 'Anzeigename',
	'Expense balance': 'Ausgabensaldo',
	'Expense balance per member': 'Ausgabensaldo je Mitglied',
	'Expense categories': 'Ausgabenkategorien',
	Expenses: 'Ausgaben',
	'Expenses feature enabled': 'Ausgabenfunktion aktiviert',
	Friday: 'Freitag',
	'Household administrator': 'Haushaltsadministrator',
	'Household members': 'Haushaltsmitglieder',
	'Household owner': 'Haushaltsinhaber',
	Households: 'Haushalte',
	'Icon key': 'Symbolschlüssel',
	'Import a recipe from a URL': 'Rezept von einer URL importieren',
	Information: 'Information',
	Ingredients: 'Zutaten',
	'Item catalog': 'Artikelkatalog',
	Items: 'Artikel',
	'Items as text': 'Artikel als Text',
	Language: 'Sprache',
	'Last seen': 'Zuletzt gesehen',
	'Meal planner': 'Essensplaner',
	Monday: 'Montag',
	Name: 'Name',
	'Newest expense': 'Neueste Ausgabe',
	'Newest expense amount': 'Betrag der neuesten Ausgabe',
	'Newest expense date': 'Datum der neuesten Ausgabe',
	'Next cooking date': 'Nächstes Kochdatum',
	'Next planned meal': 'Nächste geplante Mahlzeit',
	'Next planned recipe ID': 'ID des nächsten geplanten Rezepts',
	'Number of categories': 'Anzahl der Kategorien',
	'Number of expenses read': 'Anzahl der gelesenen Ausgaben',
	'Number of items': 'Anzahl der Artikel',
	'Number of known items': 'Anzahl der bekannten Artikel',
	'Number of lists': 'Anzahl der Listen',
	'Number of members': 'Anzahl der Mitglieder',
	'Number of planned meals': 'Anzahl der geplanten Mahlzeiten',
	'Number of recipes': 'Anzahl der Rezepte',
	'Number of tags': 'Anzahl der Schlagwörter',
	'Photo URL': 'Foto-URL',
	'Plan a recipe, as JSON: {"recipe_id": 1, "cooking_date": 1700000000000}':
		'Rezept einplanen, als JSON: {"recipe_id": 1, "cooking_date": 1700000000000}',
	'Planned meals': 'Geplante Mahlzeiten',
	'Planned meals by weekday': 'Geplante Mahlzeiten nach Wochentag',
	'Planned weekdays': 'Geplante Wochentage',
	'Planner feature enabled': 'Planerfunktion aktiviert',
	'Preparation time': 'Vorbereitungszeit',
	'Recalculate member balances': 'Mitgliedersalden neu berechnen',
	'Recent expenses': 'Aktuelle Ausgaben',
	'Recently removed items': 'Kürzlich entfernte Artikel',
	'Recipe ID': 'Rezept-ID',
	'Recipe name': 'Rezeptname',
	'Recipe overview': 'Rezeptübersicht',
	Recipes: 'Rezepte',
	'Remove all items from the list': 'Alle Artikel von der Liste entfernen',
	'Remove this item from the list': 'Diesen Artikel von der Liste entfernen',
	'Remove this meal from the plan': 'Diese Mahlzeit aus dem Plan entfernen',
	'Result of the last import': 'Ergebnis des letzten Imports',
	Saturday: 'Samstag',
	Servings: 'Portionen',
	'Shopping lists': 'Einkaufslisten',
	Source: 'Quelle',
	'Spending overview by period': 'Ausgabenübersicht nach Zeitraum',
	'Spent in the current period': 'Im aktuellen Zeitraum ausgegeben',
	Sunday: 'Sonntag',
	'Tags as text': 'Schlagwörter als Text',
	Thursday: 'Donnerstag',
	'Total spent in the current period': 'Gesamtausgaben im aktuellen Zeitraum',
	'Total time': 'Gesamtzeit',
	Tuesday: 'Dienstag',
	Uncategorised: 'Ohne Kategorie',
	'User ID': 'Benutzer-ID',
	Username: 'Benutzername',
	Visibility: 'Sichtbarkeit',
	Wednesday: 'Mittwoch',
};

/**
 * Turns an English name into the multilingual form ioBroker stores.
 *
 * Falling back to the English string keeps dynamic names, which have no entry
 * in the table, working unchanged.
 *
 * @param name - English name of the state or channel
 */
export function localize(name: string): ioBroker.StringOrTranslated {
	const german = GERMAN[name];
	return german ? { en: name, de: german } : name;
}
