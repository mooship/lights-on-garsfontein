// Afrikaans is the default and the source of truth: en.ts must match this shape.
// Public copy never says how an outage was recorded (no "sensor" or "met die hand").

export const af = {
  // `switchTo` labels the language switch and `next` is its text, both written in the next locale.
  lang: { switchTo: 'Switch to English', next: 'English' },
  theme: { label: 'Wissel tema', toDark: 'Skakel oor na donker modus', toLight: 'Skakel oor na ligte modus' },
  // `m` is the compact minute for the tab title ("1u 5m").
  units: { d: 'd', h: 'u', min: 'min', m: 'm', s: 's' },
  day: { today: 'vandag', yesterday: 'gister', on: (day: string) => `op ${day}` },
  tab: { ON: 'AAN', OFF: 'AF' },
  banner: { region: 'Kennisgewing', dismiss: 'Maak toe' },
  masthead: {
    eyebrow: 'Wyk 45 · Pretoria',
    notice: 'Onafhanklike diens. Nie verbonde aan of onderskryf deur die Stad Tshwane of Eskom nie.',
  },
  footer: {
    nav: 'Webwerf',
    privacy: 'Privaatheid en voorwaardes',
    csv: 'Onderbrekingsdata (CSV)',
    feed: 'Atom-voer',
    signIn: 'Teken in',
    measured: 'Gemeet in Garsfontein Uitb. 16, Pretoria · Wyk 45 · Streek 6, Stad Tshwane',
    operator: 'Onafhanklik bedryf deur ’n inwoner van Garsfontein Uitb. 16.',
  },
  loading: 'Laai tans…',
  share: {
    button: 'Deel met bure',
    text: 'Is die krag af in Garsfontein? Kyk hier:',
    whatsapp: 'Deel op WhatsApp',
    telegram: 'Deel op Telegram',
    copy: 'Kopieer skakel',
    // Added to the WhatsApp and Telegram links' names: they open in a new tab.
    newTab: '(maak in ’n nuwe oortjie oop)',
    copied: 'Skakel gekopieer',
    copyFailed: 'Kon nie die skakel kopieer nie.',
  },
  // What the measuring point covers; `measured` gets site.landmark, which may be empty.
  scope: {
    measured: (landmark: string) =>
      landmark
        ? `Gemeet in Garsfontein Uitb. 16, naby ${landmark}. Party strate kan anders wees.`
        : 'Gemeet in Garsfontein Uitb. 16. Party strate kan anders wees.',
  },
  // `report` is the link to site.faultReporting.url.
  safety: {
    live: 'Behandel kraglyne altyd as lewendig.',
    report: 'Meld foute by die Stad Tshwane aan',
  },
  // The social card (scripts/build-og.ts).
  og: { question: 'Is die krag af in Garsfontein?', cta: 'Kyk hier vir die huidige status' },
  status: {
    heading: 'Huidige status',
    ON: 'Die krag is aan',
    OFF: 'Die krag is af',
    // ON without a fresh live reading: no outage is known, but nothing measured the power as on.
    NONE: 'Geen onderbreking aangemeld nie',
    // Under NONE instead of `for`: `day` is vandag, gister or "op Sa. 17 Okt.".
    for: (duration: string) => `Al ${duration}`,
    loading: 'Laai tans die huidige status…',
    wentOff: (time: string, day: string) => `Die onderbreking het ${day} om ${time} begin.`,
    planned: (time: string, day: string) => `Beplande onderbreking sedert ${day} om ${time}.`,
    noOutages: (date: string) => `Geen onderbrekings sedert die rekord op ${date} begin het nie.`,
    lastOutage: (from: string, to: string, day: string, lasted: string) =>
      `Laaste onderbreking: ${day} van ${from} tot ${to} (${lasted}).`,
    stale: (time: string) => `Kan nie die bediener bereik nie. Dit is die status soos om ${time}.`,
    // No reply in time (offline or a slow connection): the last status this browser saw. Without a day it is today's.
    offline: (time: string, day?: string) => `Geen verbinding · status soos ${day ? `${day} ` : ''}om ${time}`,
    unreachable: 'Kan nie die bediener bereik nie. Ons probeer binnekort weer.',
  },
  history: {
    title: 'Onlangse onderbrekings',
    empty: 'Nog geen onderbrekings aangeteken nie.',
    failed: 'Die onderbrekingsgeskiedenis kon nie gelaai word nie.',
    range: (from: string, to: string) => `${from} tot ${to}`,
    now: 'nou',
    ongoing: 'Aan die gang',
    planned: 'Beplan',
  },
  trends: {
    title: 'Statistiek',
    tableLabel: 'Wys die weeklikse syfers',
    refreshFailed: (time: string) => `Kon nie die statistiek bywerk nie. Dit is die syfers soos om ${time}.`,
    loadFailed: 'Kon nie die statistiek laai nie. Ons probeer binnekort weer.',
    same: 'Onveranderd teenoor die vorige 30 dae',
    change: (sign: string, amount: string) => `${sign}${amount} teenoor die vorige 30 dae`,
    startsOn: (date: string) => `Die rekord begin op ${date}.`,
    since: (date: string) => `Sedert ${date}.`,
    last30: 'Afgelope 30 dae.',
    withoutPower: 'Tyd sonder krag',
    outages: 'Onderbrekings',
    planned: (n: number) => `${n} beplan`,
    daysAffected: 'Dae met ’n onderbreking',
    daysOf: (days: number, total: number) => `${days} van ${total}`,
    longest: 'Langste onderbreking',
    average: (duration: string) => `Gemiddeld ${duration}`,
    chartEmpty: 'Nog geen onderbrekings om te wys nie.',
    chartTitle: 'Ure sonder krag per week',
    chartLabel:
      'Ure sonder krag per week. Gebruik die pyltjiesleutels om tussen weke te beweeg, of maak die tabel hieronder oop.',
    weekOf: (day: string) => `Week van ${day}`,
    off: 'af',
    // "keer" keeps the readout on one line on a phone; "onderbrekings" wraps.
    outageCount: (n: number) => `${n} keer`,
    soFar: ' (tot dusver)',
    // The first week, when records began after its Monday.
    partial: (day: string) => ` (vanaf ${day})`,
    thisWeek: 'Hierdie week',
    weekCol: 'Week van',
    hoursCol: 'Ure sonder krag',
    outagesCol: 'Onderbrekings',
    download: 'Laai alle onderbrekings af (CSV)',
    howTitle: 'Hoe ons meet',
    how: [
      'Onderbrekings korter as sowat 3 minute word dalk nie aangeteken nie.',
      'Beplande onderbrekings is ingesluit.',
      '’n Dag tel as daar op enige tydstip daardie dag ’n onderbreking was.',
      'Die syfers dek net onderbrekings wat by die meetpunt aangeteken is.',
    ],
  },
};

export type Messages = typeof af;
