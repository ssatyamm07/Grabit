/** Search synonyms for discovery */
export const migration009 = {
	id: '009_search_synonyms',
	async up(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS search_synonyms (
				id SERIAL PRIMARY KEY,
				term TEXT NOT NULL,
				synonym TEXT NOT NULL,
				UNIQUE (term, synonym)
			)
		`);
		await client.query(`
			CREATE INDEX IF NOT EXISTS search_synonyms_term_idx ON search_synonyms (lower(term))
		`);

		const pairs = [
			['milk', 'dairy'],
			['doodh', 'milk'],
			['kirana', 'grocery'],
			['atta', 'flour'],
			['rice', 'chawal'],
			['ac', 'air conditioner'],
			['plumbing', 'plumber'],
			['electrician', 'wiring'],
			['salt', 'namak'],
			['bread', 'pav'],
		];
		for (const [term, synonym] of pairs) {
			await client.query(
				`INSERT INTO search_synonyms (term, synonym) VALUES ($1,$2)
				 ON CONFLICT (term, synonym) DO NOTHING`,
				[term, synonym]
			);
			await client.query(
				`INSERT INTO search_synonyms (term, synonym) VALUES ($1,$2)
				 ON CONFLICT (term, synonym) DO NOTHING`,
				[synonym, term]
			);
		}
	},
};
