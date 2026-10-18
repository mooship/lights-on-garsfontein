/**
 * This deployment's identity, in one place. To run the app for another area, change the values
 * here, the place copy in src/i18n/*.ts and your wrangler.toml (see wrangler.example.toml), then
 * review privacy.html. Plain data with no imports, so the Worker, the app, the build and the
 * scripts can all read it.
 */
export const site = {
  /** Used in file names, e.g. the CSV download. */
  slug: 'lights-on-garsfontein',
  /** The public origin. The Worker reads its own copy from the SITE_URL var; keep the two equal. */
  url: 'https://garsfontein.timothybrits.co.za',
  repo: 'https://github.com/mooship/lights-on-garsfontein',
  brand: { short: 'Lights On?', full: 'Lights On, Garsfontein?' },
  /** The contact email is the CONTACT_EMAIL Worker secret, kept out of the repo and the page source. */
  operator: { name: 'Timothy Brits' },
  /** A landmark near the measuring point that residents recognise; never the exact address. */
  landmark: 'Mediclinic Denmar',
  /** The City's online power-failure form. Check it still works before relying on it. */
  faultReporting: { url: 'https://powerfailure.tshwane.gov.za/Tshwanesms/NewCall' },
  /** Licence for the outage data (CSV and API); the code is MIT. */
  dataLicence: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  /** For structured data (JSON-LD). Visible place copy lives in the dictionaries. */
  area: {
    name: 'Garsfontein Extension 16, Ward 45, Pretoria',
    region: 'Region 6, City of Tshwane',
    city: 'City of Tshwane',
    province: 'Gauteng',
    country: 'ZA',
  },
  /** When records begin; nothing before it counts as tracked time. */
  trackingSince: '2026-10-17T00:00:00+02:00',
  /** IANA zone for every displayed date and time. */
  timeZone: 'Africa/Johannesburg',
  /**
   * The zone's UTC offset, for day and week boundaries in the stats and the admin time inputs.
   * Fixed: zones with daylight saving are not supported.
   */
  utcOffsetMinutes: 120,
  /** The first is the default. A single entry hides the language switch. */
  locales: ['af', 'en'],
  /** BCP 47 tags for Intl formatting, per locale. */
  intlLocales: { af: 'af-ZA', en: 'en-ZA' },
} as const;

export type Locale = (typeof site.locales)[number];
