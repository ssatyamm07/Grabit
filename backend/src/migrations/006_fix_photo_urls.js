/** Fix store_verifications.photo_urls typo from 005 (mag_urls) */
export const migration006 = {
	id: '006_fix_photo_urls',
	async up(client) {
		await client.query(`
			DO $$
			BEGIN
				IF EXISTS (
					SELECT 1 FROM information_schema.columns
					WHERE table_schema = 'public'
					  AND table_name = 'store_verifications'
					  AND column_name = 'mag_urls'
				) THEN
					ALTER TABLE store_verifications RENAME COLUMN mag_urls TO photo_urls;
				END IF;
			END $$;
		`);
	},
};
