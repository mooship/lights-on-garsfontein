// Afrikaans is the default and the source of truth: en.ts must match this shape.
// Public copy never says how an outage was recorded (no "sensor" or "met die hand").

export const af = {
  // `switchTo` labels the language switch and `next` is its text, both written in the next locale.
  lang: { switchTo: 'Switch to English', next: 'English' },
  theme: { label: 'Wissel tema', toDark: 'Skakel oor na donker tema', toLight: 'Skakel oor na ligte tema' },
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
        ? `Gemeet in Garsfontein Uitb. 16, naby ${landmark}. Sommige strate kan verskil.`
        : 'Gemeet in Garsfontein Uitb. 16. Sommige strate kan verskil.',
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
    for: (duration: string) => `Al ${duration}`,
    loading: 'Laai tans die huidige status…',
    // `day` is formatRelativeDay's: vandag, gister or "op Sa. 17 Okt.".
    wentOff: (time: string, day: string) => `Die onderbreking het ${day} om ${time} begin.`,
    planned: (time: string, day: string) =>
      `Beplande onderbreking wat vooraf aangekondig is. Dit het ${day} om ${time} begin.`,
    noOutages: (date: string) => `Geen onderbrekings sedert die rekord op ${date} begin het nie.`,
    lastOutage: (from: string, to: string, day: string, lasted: string) =>
      `Laaste onderbreking: ${day} van ${from} tot ${to} (${lasted}).`,
    stale: (time: string) => `Kan nie die bediener bereik nie. Dit is die status soos dit om ${time} was.`,
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
    allTitle: 'Alle onderbrekings',
    showAll: 'Wys alle onderbrekings',
    showRecent: 'Wys slegs onlangse onderbrekings',
    pages: 'Bladsye van onderbrekings',
    newer: 'Nuwer',
    older: 'Ouer',
    page: (n: number, count: number) => `Bladsy ${n} van ${count}`,
  },
  trends: {
    title: 'Statistiek',
    tableLabel: 'Wys die weeklikse syfers',
    refreshFailed: (time: string) => `Kon nie die statistiek bywerk nie. Dit is die syfers soos dit om ${time} was.`,
    // Retried every STATS_POLL_MS (src/lib/poll.ts).
    loadFailed: 'Kon nie die statistiek laai nie. Ons probeer oor ’n paar minute weer.',
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
    /** `since` is the day the record began, until 30 days are on record; then null. */
    byHourTitle: (since: string | null, outages: number) =>
      `Wanneer onderbrekings voorkom (${since ? `sedert ${since}` : 'afgelope 30 dae'}, ${outages} ${outages === 1 ? 'onderbreking' : 'onderbrekings'})`,
    byHourEmpty: 'Geen onderbrekings in die afgelope 30 dae nie.',
    byHourLabel: 'Ure sonder krag volgens die tyd van die dag. Gebruik die pyltjiesleutels om tussen ure te beweeg.',
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
      // "3 minute" is HEARTBEAT_THRESHOLD_MS (shared/api.ts); change them together.
      'Onderbrekings korter as sowat 3 minute word dalk nie aangeteken nie.',
      'Beplande onderbrekings is ingesluit.',
      '’n Dag tel as daar op enige tydstip daardie dag ’n onderbreking was.',
      'Die syfers dek net onderbrekings wat by die meetpunt aangeteken is.',
    ],
  },
  // The alerts bell (src/components/AlertsBell.tsx) and card (AlertsCard.tsx). The bell's name is
  // `label`; the others describe its state. The card never claims more than the scope line says.
  alerts: {
    bell: {
      label: 'Kragkennisgewings',
      on: 'Skakel kragkennisgewings af',
      off: 'Skakel kragkennisgewings aan',
      blocked: 'Kragkennisgewings is in jou blaaier geblokkeer',
      install: 'Hoe om kragkennisgewings te kry',
    },
    card: {
      heading: 'Wil jy op hoogte bly?',
      body: 'Kry ’n kennisgewing wanneer die krag in Uitbreiding 16 afgaan, en wanneer dit weer aan is.',
      scope: 'Daar word by een punt in Uitbreiding 16 gemeet, so sommige strate kan verskil.',
      privacy: 'Wat ons stoor',
      turnOn: 'Skakel kennisgewings aan',
      notNow: 'Nie nou nie',
      noThanks: 'Nee dankie',
      close: 'Maak toe',
      // An iPhone offers notifications only to a site opened from the home screen. iOS has no
      // Afrikaans, so the menu item keeps its English name.
      iosIntro: 'Op ’n iPhone moet jy die webwerf eers by jou tuisskerm voeg:',
      iosSteps: [
        'Tik op die deelknoppie in Safari.',
        'Kies “Add to Home Screen”.',
        'Maak die webwerf van jou tuisskerm af oop en tik op die klokkie.',
      ],
      blockedHelp:
        'Kennisgewings vir hierdie webwerf is in jou blaaier geblokkeer. Laat kennisgewings in die blaaier se instellings toe, en tik dan weer op die klokkie.',
      unsupported: 'Hierdie blaaier kan nie kennisgewings van die webwerf ontvang nie. Probeer ’n ander blaaier.',
      failed: 'Dit het nie gewerk nie. Probeer asseblief oor ’n rukkie weer.',
      turnedOn: 'Kennisgewings is aangeskakel.',
      turnedOff: 'Kennisgewings is afgeskakel.',
    },
  },
  // Web push alerts. `on` takes the time it came back and how long it was off (formatted with `units`).
  push: {
    off: { title: 'Die krag is af', body: (time: string) => `Geen krag in Garsfontein Uitb. 16 sedert ${time} nie.` },
    planned: {
      title: 'Beplande onderbreking',
      body: (time: string) => `Dit het om ${time} begin en is vooraf aangekondig.`,
    },
    on: {
      title: 'Die krag is weer aan',
      body: (time: string, duration: string) => `Weer aan om ${time} na ${duration}.`,
    },
    dismissed: {
      title: 'Die krag is aan',
      body: 'Die vorige waarskuwing oor Garsfontein Uitb. 16 is nie bevestig nie.',
    },
  },
};

export type Messages = typeof af;
