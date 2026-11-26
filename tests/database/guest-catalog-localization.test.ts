import {randomBytes} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import pg from "pg";
import {afterAll, beforeAll, expect, test} from "vitest";

const directory = "supabase/migrations";
const migrationName = "20261126090001_localize_guest_catalog.sql";
const readMigration = (name: string) => readFileSync(`${directory}/${name}`, "utf8");
const databaseName = `catalog_locale_${randomBytes(6).toString("hex")}`;
const operatorUrl = new URL(process.env.MIGRATION_DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(operatorUrl.hostname)) throw new Error("Loopback PostgreSQL required");
const operator = new pg.Client({connectionString: operatorUrl.href});
const fixtureUrl = new URL(operatorUrl);
fixtureUrl.pathname = `/${databaseName}`;
const db = new pg.Client({connectionString: fixtureUrl.href});

beforeAll(async () => {
  await operator.connect();
  await operator.query(`CREATE DATABASE ${databaseName}`);
  await db.connect();
  for (const name of readdirSync(directory).filter(name => name.endsWith(".sql") && name < migrationName).sort()) {
    await db.query(readMigration(name));
  }
});

afterAll(async () => {
  await db.end();
  await operator.query(`DROP DATABASE IF EXISTS ${databaseName}`);
  await operator.end();
});

test("each guest offer, destination and booking option has copy in the selected language", async () => {
  await db.query("BEGIN");
  try {
    await db.query(readMigration(migrationName));
    const locales = await db.query(`
      SELECT t.locale, count(*)::int AS offers, count(DISTINCT t.summary)::int AS summaries,
        bool_and(t.summary !~* 'development|fixture' AND t.meeting_notes <> '') AS guest_copy,
        bool_and(t.locale = 'en' OR
          (t.title <> en.title AND t.summary <> en.summary AND t.itinerary <> en.itinerary
           AND t.inclusions <> en.inclusions AND t.exclusions <> en.exclusions AND t.meeting_notes <> en.meeting_notes)) AS localized
      FROM app.service_translations t
      JOIN app.services s ON s.id = t.service_id
      JOIN app.categories c ON c.id = s.category_id AND c.active AND c.code <> 'photography'
      JOIN app.service_translations en ON en.service_id = s.id AND en.locale = 'en'
      GROUP BY t.locale ORDER BY t.locale`);
    expect(locales.rows).toHaveLength(10);
    for (const row of locales.rows) {
      expect(row, row.locale).toMatchObject({offers: 7, summaries: 7, guest_copy: true, localized: true});
    }
    const titles = await db.query("SELECT locale,title FROM app.service_translations WHERE service_id=md5('service:boat_tours')::uuid");
    expect(Object.fromEntries(titles.rows.map(row => [row.locale, row.title]))).toEqual({
      en: "Boat trip from Marsa Alam", ar: "يوم في البحر من مرسى علم", de: "Bootsausflug ab Marsa Alam",
      es: "Día en barco desde Marsa Alam", fr: "Journée en bateau au départ de Marsa Alam",
      it: "Giornata in barca da Marsa Alam", nl: "Dagtocht per boot vanuit Marsa Alam",
      pl: "Rejs z Marsa Alam", ru: "Морская прогулка из Марса-Алама", uk: "Морська прогулянка з Марса-Алама",
    });
    const destinations = await db.query(`
      SELECT t.locale, count(*)::int AS destinations FROM app.destination_translations t
      JOIN app.destination_translations en ON en.destination_id=t.destination_id AND en.locale='en'
      WHERE t.description !~* 'synthetic|development' AND (t.locale='en' OR t.description<>en.description)
      GROUP BY t.locale`);
    expect(destinations.rows).toHaveLength(10);
    expect(destinations.rows.every(row => row.destinations === 5)).toBe(true);
    const transfers = await db.query(`
      SELECT t.locale, count(DISTINCT t.title)::int AS options FROM app.variant_translations t
      JOIN app.service_variants v ON v.id=t.variant_id AND v.service_id=md5('service:transportation')::uuid
      JOIN app.variant_translations en ON en.variant_id=v.id AND en.locale='en'
      WHERE t.description !~* 'development|fixture' AND (t.locale='en' OR t.title<>en.title AND t.description<>en.description)
      GROUP BY t.locale`);
    expect(transfers.rows).toHaveLength(10);
    expect(transfers.rows.every(row => row.options === 2)).toBe(true);
  } finally {
    await db.query("ROLLBACK");
  }
});

test("upgrading protects owner edits, approvals, pricing and archived or nonsynthetic records", async () => {
  await db.query("BEGIN");
  try {
    await db.query(`UPDATE app.service_translations SET title='Sortie personnalisée',approved_at=NULL,slug='ma-sortie'
      WHERE service_id=md5('service:boat_tours')::uuid AND locale='fr';
      UPDATE app.services SET synthetic=false WHERE id=md5('service:tours')::uuid;
      UPDATE app.services SET destination_id=md5('destination:luxor')::uuid WHERE id=md5('service:beach_buggy')::uuid;
      UPDATE app.service_variants SET active=false WHERE id=md5('variant:scuba_diving')::uuid;
      UPDATE app.variant_translations SET description='Sur demande.' WHERE variant_id=md5('variant:snorkeling')::uuid AND locale='fr';
      UPDATE app.destination_translations SET description='Texte de la rédaction.' WHERE destination_id=md5('destination:hurghada')::uuid AND locale='fr';`);
    const snapshot = async () => (await db.query(`
      SELECT (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM app.services s) AS services,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM app.price_rules p) AS prices,
        (SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM app.departures d) AS departures,
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY locale) FROM app.variant_translations v WHERE variant_id=md5('variant:scuba_diving')::uuid) AS inactive,
        (SELECT jsonb_agg(to_jsonb(t) ORDER BY service_id,locale) FROM app.service_translations t
          WHERE service_id IN (md5('service:tours')::uuid,md5('service:beach_buggy')::uuid,md5('service:shore_dives')::uuid,md5('service:photography')::uuid)) AS excluded`)).rows[0];
    const before = await snapshot();
    await db.query(readMigration(migrationName));
    expect(await snapshot()).toEqual(before);
    const service = await db.query("SELECT title,slug,approved_at,summary FROM app.service_translations WHERE service_id=md5('service:boat_tours')::uuid AND locale='fr'");
    expect(service.rows[0]).toMatchObject({title:"Sortie personnalisée", slug:"ma-sortie", approved_at:null});
    expect(service.rows[0].summary).not.toMatch(/Development preview/);
    expect((await db.query("SELECT description FROM app.variant_translations WHERE variant_id=md5('variant:snorkeling')::uuid AND locale='fr'")).rows[0].description).toBe("Sur demande.");
    expect((await db.query("SELECT description FROM app.destination_translations WHERE destination_id=md5('destination:hurghada')::uuid AND locale='fr'")).rows[0].description).toBe("Texte de la rédaction.");
  } finally {
    await db.query("ROLLBACK");
  }
});
