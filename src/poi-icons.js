import * as I from '@mdi/js';

// Category glyph per POI layer (Material Design Icons, Apache 2.0), matched on "ID title". First match wins.
const RULES = [
  [/SCOOTER/, I.mdiScooter],
  [/GURGEL|COVIDTEST|TESTSTRASSE/, I.mdiTestTube],
  [/IMPF/, I.mdiNeedle],
  [/ALTSTOFF|MISTPLATZ|PROBLEMSTOFF/, I.mdiRecycle],
  [/AMBULANZ|KRANKENHAUS|PRIMAERVERSORG/, I.mdiHospitalBox],
  [/AMPEL/, I.mdiTrafficLight],
  [/APOTHEKE/, I.mdiPill],
  [/FUNDPUNKTE|BOHR/, I.mdiPickaxe],
  [/HEBAMME/, I.mdiBabyCarriage],
  [/ARZT/, I.mdiDoctor],
  [/AUSBLICK|SICHTBARKEIT|BLICKPKT/, I.mdiBinoculars],
  [/BADESTELLE|SCHWIMMBAD/, I.mdiPool],
  [/BANK|STADTKASSE/, I.mdiBank],
  [/BEHINDERTEN|EURO-KEY|GEHSTEIGABS/, I.mdiWheelchairAccessibility],
  [/BUECHEREI/, I.mdiBookOpenVariant],
  [/TOURISTIKHTS|BUSPARK/, I.mdiBus],
  [/CAMPING/, I.mdiTent],
  [/CARSHARING/, I.mdiCarConnected],
  [/COOLEZONE|SOMMERSPRITZER/, I.mdiSprinkler],
  [/DEFIBRILLATOR/, I.mdiHeartPulse],
  [/ELADESTELLE/, I.mdiEvStation],
  [/FAHRRAD|RADSERVICE|RADGRAETZEL/, I.mdiBicycle],
  [/FAHRSCHULE/, I.mdiCar],
  [/FIAKER/, I.mdiHorse],
  [/FRIEDHOF/, I.mdiGraveStone],
  [/FUNDBOX/, I.mdiPackageVariant],
  [/GARAGE/, I.mdiGarage],
  [/PARKENAUTOMAT|PARKENVERKAUF/, I.mdiTicket],
  [/LADEZONE/, I.mdiTruck],
  [/MOTORRAD/, I.mdiMotorbike],
  [/GRILL/, I.mdiGrill],
  [/MULTIMEDIA/, I.mdiMonitor],
  [/UBAHN|UBHALT/, I.mdiSubwayVariant],
  [/BIMHALT|HALTESTELLE|STATIONEN/, I.mdiTram],
  [/SYNAGOG/, I.mdiStarDavid],
  [/RELIGION/, I.mdiChurch],
  [/UNTERKUNFT|HOTEL/, I.mdiBed],
  [/HUNDE/, I.mdiDog],
  [/HYDRANT/, I.mdiFireHydrant],
  [/INTORG|BOTSCHAFT/, I.mdiEarth],
  [/KINDERGARTEN/, I.mdiTeddyBear],
  [/WALDSPIEL|SPIELPLATZ/, I.mdiSlide],
  [/JGDANGEBOT/, I.mdiHumanChild],
  [/KUNSTWERK/, I.mdiPalette],
  [/KULTURSOMMER/, I.mdiTheater],
  [/LUFTGUETE|DAUERZAEHL/, I.mdiGauge],
  [/ADVENTMARKT/, I.mdiPineTreeVariant],
  [/SOZIALMARKT|MARKT|MAERKTE/, I.mdiStorefront],
  [/NACHHALTIGMEHRWEG|SCHANIGARTEN/, I.mdiFoodForkDrink],
  [/BURGSCHLOSS/, I.mdiCastle],
  [/TRINKBRUNNEN/, I.mdiCup],
  [/BRUNNEN|BRUOGD/, I.mdiFountain],
  [/MUSEUM/, I.mdiBankOutline],
  [/MUSIK/, I.mdiMusic],
  [/ALLEEBAUM|NATDENKMAL/, I.mdiTree],
  [/NETZWERKNAT|GRUEN|PARKINFO/, I.mdiPineTree],
  [/POLIZEI/, I.mdiPoliceBadge],
  [/SCHIFF/, I.mdiFerry],
  [/UNIVERSITAET|VOLKSHOCHSCHULE|SCHULE/, I.mdiSchool],
  [/SEHENSWUERDIG|WIENTOURISMUS/, I.mdiCamera],
  [/SIRENE/, I.mdiBullhorn],
  [/ENSONST|ENINNOV/, I.mdiLightbulbOn],
  [/PVANL|STANL|SOLAR/, I.mdiSolarPower],
  [/WPANL/, I.mdiHeatPump],
  [/FOERDERUNGGEBAEUDE/, I.mdiLeaf],
  [/SPORT|TURNSAAL/, I.mdiSoccer],
  [/MARATHON/, I.mdiRun],
  [/SPAZIER|WANDERWEG|SILVESPFAD/, I.mdiHiking],
  [/TRAUMHOCHZEIT/, I.mdiRing],
  [/BAUSTELLE/, I.mdiTrafficCone],
  [/VORTEILSCLUB/, I.mdiTagHeart],
  [/WAHLLOKAL/, I.mdiVote],
  [/WERBETRAEGER/, I.mdiBillboard],
  [/AUFZUG/, I.mdiElevator],
  [/WLAN/, I.mdiWifi],
  [/WIENERWOHNEN|WOHNPARTNER|GEBIETSBETREUUNG/, I.mdiHomeCity],
  [/WOHNPFLEGE/, I.mdiHomeHeart],
  [/WCANLAGE/, I.mdiHumanMaleFemale],
  [/BERATUNG|BEWEGTEAPOTHEKE/, I.mdiHandHeart],
  [/AMT|BUERGERDIENST/, I.mdiOfficeBuilding],
  [/PARTIZIPATION|EUPROJEKT/, I.mdiHandshake],
  [/HOEHENFEST|GABELPUNKT|KNOTEN|STRKONSTRUKT|DONAUKILOMETER/, I.mdiVectorPoint],
  [/DONAUINS/, I.mdiSignDirection],
  [/GEONAMEN|KULTURWIKI|GEBAEUDEINFO|DACHKATASTER/, I.mdiInformation],
];

export function iconFor(layer) {
  const key = `${layer.id} ${layer.title}`.toUpperCase();
  for (const [re, path] of RULES) if (re.test(key)) return path;
  return I.mdiMapMarker;
}

// Pin outline in a 64x64 box: head circle (r 12) at (32, 15), tip at (32, 32) = sprite centre (the anchor).
const HEAD = { x: 32, y: 15, r: 12 };
function pinPath(g, s) {
  const { x, y, r } = HEAD;
  const a = Math.acos(r / (32 - y)); // tangent points seen from the tip
  g.beginPath();
  g.moveTo(32 * s, 32 * s);
  g.arc(x * s, y * s, r * s, Math.PI / 2 + a, Math.PI / 2 - a);
  g.closePath();
}

/** Teardrop pin in the layer colour with a white glyph; the upper half of the square holds the pin. */
export function pinCanvas(color, iconPath, size = 128) {
  const s = size / 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  pinPath(g, s);
  g.lineJoin = 'round';
  g.lineWidth = 3.6 * s;
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.stroke();
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 2 * s;
  g.strokeStyle = '#fff';
  g.stroke();
  // 24x24 glyph scaled into the head
  const k = (HEAD.r * 1.25 * s) / 24;
  g.save();
  g.translate(HEAD.x * s - 12 * k, HEAD.y * s - 12 * k);
  g.scale(k, k);
  g.fillStyle = '#fff';
  g.fill(new Path2D(iconPath));
  g.restore();
  return c;
}

/** Hit box of the pin relative to the sprite size: |x| <= w, 0 <= y (up from the tip) <= h. */
export const PIN_HIT = { w: (HEAD.r + 1) / 64, h: (32 - HEAD.y + HEAD.r + 1) / 64 };

/** Small round badge for the POI list. */
export const iconBadge = (color, iconPath) =>
  `<svg class="ico" viewBox="-4 -4 32 32" aria-hidden="true"><circle cx="12" cy="12" r="15" fill="${color}"/><path d="${iconPath}" fill="#fff"/></svg>`;

// List sections (the WFS has no categories of its own), matched like RULES; first match wins.
export const CATEGORIES = [
  ['Planung & Geodaten', /^(STRUK|PLANUNG)|HOEHENFEST|GABELPUNKT|BOHR|DONAUKILOMETER|GEONAMEN|GEBAEUDEINFO|KNOTEN|STRKONSTRUKT/],
  ['Kultur & Tourismus', /MUSEUM|SEHENSWUERDIG|WIENTOURISMUS|KUNSTWERK|KULTUR|BURGSCHLOSS|SYNAGOG|RELIGION|FUNDPUNKTE|MONUMENTALBRU|AUSBLICK|SICHTBARKEIT|SPAZIER|UNTERKUNFT|CAMPING|DACHKATASTER|FRIEDHOF|TRAUMHOCHZEIT/],
  ['Freizeit, Sport & Natur', /BADESTELLE|SCHWIMMBAD|GRILL|HUNDEZONE|PARKINFO|GRUEN|NETZWERKNAT|NATDENKMAL|SPORT|WANDERWEG|DONAUINS|COOLEZONE|SOMMERSPRITZER|TRINKBRUNNEN|MARATHON|SILVESPFAD|SPIELPLATZ|WALDSPIEL/],
  ['Märkte & Gastronomie', /MARKT|MAERKTE|SCHANIGARTEN|MEHRWEG/],
  ['Gesundheit, Soziales & Wohnen', /GURGEL|COVID|IMPF|AMBULANZ|KRANKENHAUS|PRIMAER|APOTHEKE|ARZT|HEBAMME|DEFIBRILLATOR|BERATUNG|WOHNPFLEGE|WOHNPARTNER|WIENERWOHNEN|GEBIETSBETREUUNG/],
  ['Bildung & Jugend', /BUECHEREI|KINDERGARTEN|SCHULE|UNIVERSITAET|MUSIK|JGDANGEBOT|TURNSAAL/],
  ['Verkehr & Mobilität', /SCOOTER|AMPEL|BUSPARK|CARSHARING|ELADESTELLE|FAHRRAD|RAD(SERVICE|GRAETZEL)|FIAKER|GARAGE|PARKEN|LADEZONE|MOTORRAD|HALTEST|UBAHN|^STATIONEN|TOURISTIKHTS|SCHIFF|AUFZUG|BEHINDERTENPARK|GEHSTEIG|BAUSTELLE|DAUERZAEHL/],
  ['Umwelt & Energie', /PVANL|STANL|WPANL|ENSONST|ENINNOV|FOERDERUNGGEBAEUDE|LUFTGUETE|ALTSTOFF|MISTPLATZ|PROBLEMSTOFF|HUNDESACKERL/],
  ['Verwaltung & Service', /AMT|BUERGERDIENST|STADTKASSE|POLIZEI|BOTSCHAFT|INTORG|WAHLLOKAL|FUNDBOX|WCANLAGE|WLAN|MULTIMEDIA|BANK|VORTEILSCLUB|PARTIZIPATION|EUPROJEKT|SIRENE|HYDRANT|WERBETRAEGER|FAHRSCHULE/],
];
export const OTHER = 'Sonstiges';

export function categoryFor(layer) {
  const key = `${layer.id} ${layer.title}`.toUpperCase();
  return CATEGORIES.find(([, re]) => re.test(key))?.[0] ?? OTHER;
}
