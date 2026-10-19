import type { Locale } from '../../site.config.ts';

/**
 * The <head> copy of each language's page, for search results and link previews. Only the build
 * reads it (localePages in vite.config.ts), so none of it reaches the app bundle. Values from
 * site.config.ts go in as %site.<path>% and the start date as %since.<locale>%.
 */
interface Head {
  /** Also og:title. */
  title: string;
  description: string;
  ogDescription: string;
  imageAlt: string;
  /** The JSON-LD Service description. */
  serviceDescription: string;
}

export const HEAD: Record<Locale, Head> = {
  af: {
    title: 'Is die krag af in Garsfontein? · %site.brand.full%',
    description:
      'Is die krag af in Garsfontein, Pretoria? Kragstatus soos laas gemeet in Garsfontein Uitbreiding 16 (Wyk 45), en ’n rekord van kragonderbrekings.',
    ogDescription: 'Kragstatus soos laas gemeet in Garsfontein Uitbreiding 16, en ’n rekord van kragonderbrekings.',
    imageAlt: '%site.brand.full%: is die krag af in Garsfontein?',
    serviceDescription:
      '’n Oop rekord van kragonderbrekings in Garsfontein, Pretoria, bygehou sedert %since.af%. Gemeet by een punt in Garsfontein Uitbreiding 16, naby %site.landmark%. Dit geld net vir Uitbreiding 16, wat deur die Garsfontein-substasie voorsien word, en selfs daar kan sommige strate verskil. Onafhanklik bedryf deur ’n inwoner. Nie verbonde aan die Stad Tshwane of Eskom nie.',
  },
  en: {
    title: 'Is the power off in Garsfontein? · %site.brand.full%',
    description:
      'Is the power off in Garsfontein, Pretoria? Power status as last measured in Garsfontein Extension 16 (Ward 45), and a record of outages.',
    ogDescription: 'Power status as last measured in Garsfontein Ext. 16, and a record of outages.',
    imageAlt: '%site.brand.full%: is the power off in Garsfontein?',
    serviceDescription:
      'An open record of power outages in Garsfontein, Pretoria, kept since %since.en%. Measured at one point in Garsfontein Extension 16, near %site.landmark%. It speaks only for Extension 16, which is supplied by the Garsfontein substation, and even there some streets can differ. Operated independently by a resident. Not affiliated with the City of Tshwane or Eskom.',
  },
};
