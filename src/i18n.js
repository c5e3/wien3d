// UI strings in German and English (language setting). Content from the city's services, like POI layer
// titles and field values, stays as published.
const STRINGS = {
  de: {
    'menu.sub': 'Open Government Data Wien &amp; Österreich',
    'menu.keyboard': 'Tastatur &amp; Maus',
    'menu.touch': 'Touch',
    'menu.controller': 'Controller',
    'menu.places': 'Orte',
    'menu.play': 'Irgendwo klicken oder tippen oder eine beliebige Taste drücken, um loszulegen',
    'menu.pois': 'Orte &amp; POIs',
    'menu.settings': 'Einstellungen',
    'kb.1': '<kbd>W A S D</kbd> bewegen',
    'kb.2': '<kbd>Maus</kbd> umsehen',
    'kb.3': '<kbd>Leertaste</kbd> hoch · <kbd>Shift</kbd> runter',
    'kb.4': '<kbd>W</kbd><kbd>W</kbd> / <kbd>R</kbd> sprinten',
    'kb.5': '<kbd>Mausrad</kbd> Tempo',
    'kb.6': '<kbd>N</kbd> Noclip (durch Wände)',
    'kb.7': '<kbd>P</kbd> POI-Liste · <kbd>Klick</kbd> Info · <kbd>X</kbd>/<kbd>Rechtsklick</kbd> Info schließen',
    'kb.8': '<kbd>M</kbd> Mausmodus (freier Zeiger)',
    'kb.9': '<kbd>C</kbd> Koordinaten &amp; Statistik · <kbd>K</kbd> Kompass',
    'kb.esc': '<kbd>Esc</kbd> Fenster schließen / dieses Fenster anzeigen',
    'touch.1': '<kbd>Ziehen</kbd> Fadenkreuz bewegen (schnell wischen zum Drehen)',
    'touch.1.view': '<kbd>Ziehen</kbd> Ansicht verschieben (schnell wischen zum Drehen)',
    'touch.2': '<kbd>Auseinanderziehen</kbd> zum Fadenkreuz fliegen',
    'touch.3': '<kbd>Zusammenziehen</kbd> zurückweichen',
    'touch.2.pinch': '<kbd>Zusammenziehen</kbd> zum Fadenkreuz fliegen',
    'touch.3.spread': '<kbd>Auseinanderziehen</kbd> zurückweichen',
    'touch.strafe': '<kbd>2 Finger ◀ ▶</kbd> seitwärts fliegen',
    'touch.fwd': '<kbd>2 Finger ▲ ▼</kbd> vorwärts / rückwärts fliegen (wie W / S)',
    'touch.fwd.view': '<kbd>2 Finger ▼ ▲</kbd> vorwärts / rückwärts fliegen (wie W / S)',
    'touch.4': '<kbd>Tippen</kbd> Info zu dem, worauf das Fadenkreuz zeigt',
    'touch.5': '<kbd>Mit 2 Fingern tippen</kbd> Info schließen / Menü',
    'pad.1': '<kbd>{move}</kbd> bewegen · <kbd>{look}</kbd> umsehen{inv}',
    'pad.inverted': ' (hoch / runter umgekehrt)',
    'pad.2': '<kbd>{up}</kbd> hoch · <kbd>{down}</kbd> runter · <kbd>{sprint}</kbd> sprinten',
    'pad.1.drone': '<kbd>{thr}</kbd> Schub / gieren · <kbd>{rp}</kbd> nicken / rollen{inv}',
    'pad.2.drone': 'Stick loslassen: Drohne richtet sich waagrecht aus',
    'pad.3': '<kbd>RB</kbd> Info · <kbd>LB</kbd> schließen · <kbd>Y</kbd> Noclip',
    'pad.4': '<kbd>▲</kbd><kbd>▼</kbd> Tempo · <kbd>◀</kbd><kbd>▶</kbd> Orte',
    'pad.5': '<kbd>Start</kbd> Menü · <kbd>Back</kbd> Statistik',
    credits:
      'Gebäude &amp; Bäume: Stadt Wien – data.wien.gv.at (CC BY 4.0) · Orthofoto: basemap.at (CC BY 4.0) · Brücken &amp; Tunnel: MA 29, ASFINAG, Wiener Linien via data.wien.gv.at · DOM 5 m Stadt Wien · Gelände: DGM Österreich 10 m via AWS Terrain Tiles · Riesenrad-Modell: Lage © OpenStreetMap-Mitwirkende (ODbL), Maße: Wikipedia<br />Quellcode: <a href="https://github.com/c5e3/wien3d" target="_blank" rel="noopener">github.com/c5e3/wien3d</a> (MIT) · <a id="menu-legal" href="#">Datenschutz &amp; Impressum</a>',
    'mouse.hint': 'Mausmodus · <kbd>M</kbd> oder Klick in die Szene zum Weiterspielen · <kbd>Esc</kbd> Menü',
    close: 'Schließen',
    'close.info': 'Schließen (X / Esc)',
    'close.settings': 'Schließen (Esc)',
    'close.poi': 'Schließen (P / Esc)',
    'legal.title': 'Datenschutz &amp; Impressum',
    'legal.body':
      '<h3>Impressum</h3>' +
      '<p>Offenlegung gemäß § 25 Mediengesetz<br>Medieninhaber: ***<br>Kontakt: <a class="mail" href="#"></a></p>' +
      '<p>Wien 3D ist ein privates, nicht kommerzielles Hobbyprojekt ohne Werbung und ohne Einnahmen. Inhalt: eine interaktive 3D-Karte von Wien aus offenen Verwaltungsdaten. Für Richtigkeit und Vollständigkeit der dargestellten Daten wird keine Gewähr übernommen.</p>' +
      '<h3>Datenschutz</h3>' +
      '<p><b>Verantwortlich</b> ist *** (<a class="mail" href="#"></a>).</p>' +
      '<p>Diese Website verwendet <b>keine Cookies, keine Analyse- oder Tracking-Dienste und keine Werbung</b>. Es gibt keine Benutzerkonten und es werden keine Formulare oder Eingaben an mich übermittelt.</p>' +
      '<p><b>Lokaler Speicher:</b> Deine Einstellungen (z. B. Sprache, Sichtweite) und welche POI-Gruppen aufgeklappt sind, werden nur im lokalen Speicher deines Browsers abgelegt und nie übertragen. Du kannst sie jederzeit löschen, indem du die Websitedaten in deinem Browser entfernst.</p>' +
      '<p><b>Technisch notwendige Verbindungen:</b> Damit die Karte funktioniert, lädt dein Browser Daten direkt von folgenden Servern. Dabei wird, wie bei jedem Webseitenaufruf, deine IP-Adresse an den jeweiligen Anbieter übermittelt:</p>' +
      '<ul>' +
      '<li><b>Vercel Inc.</b> (USA): Hosting dieser Website. Vercel verarbeitet Zugriffsdaten (IP-Adresse, Zeitpunkt, aufgerufene Datei, Browserkennung) zur Auslieferung und Absicherung des Dienstes.</li>' +
      '<li><b>Stadt Wien</b> (data.wien.gv.at, mapsneu.wien.gv.at): Gebäude-, Baum- und POI-Daten sowie Orthofotos (basemap.at).</li>' +
      '<li><b>Amazon Web Services Inc.</b> (USA, s3.amazonaws.com): Geländehöhen (AWS Terrain Tiles).</li>' +
      '</ul>' +
      '<p>Rechtsgrundlage ist mein berechtigtes Interesse an der Bereitstellung einer funktionierenden Website (Art. 6 Abs. 1 lit. f DSGVO). Die Übermittlung in die USA an Vercel und AWS erfolgt auf Grundlage des EU-US Data Privacy Framework (Art. 45 DSGVO). Ich selbst werte keine Zugriffsdaten aus. Die Anbieter speichern sie nach ihren eigenen Datenschutzbestimmungen nur so lange, wie es für Betrieb und Sicherheit nötig ist.</p>' +
      '<p>Externe Links (z. B. zu GitHub) werden erst geöffnet, wenn du sie anklickst.</p>' +
      '<p><b>Deine Rechte:</b> Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Widerspruch (Art. 15–21 DSGVO). Schreib mir dazu einfach eine E-Mail. Außerdem kannst du dich bei der österreichischen Datenschutzbehörde beschweren (<a href="https://www.dsb.gv.at" target="_blank" rel="noopener">dsb.gv.at</a>).</p>',

    'poi.title': 'Orte &amp; POIs (OGD Wien)',
    'poi.clear': 'Alle aus',
    'poi.search': 'Suchen… (z. B. Museum, Trinkbrunnen, Kunstwerke)',
    'poi.loading': 'lädt…',
    'poi.shown': '{n} sichtbar',
    'poi.nearby': 'in der Nähe',
    'poi.on': '{n} aktiv',
    'poi.none': 'Keine passenden Kategorien.',

    building: 'Gebäude',
    tree: 'Baum',
    bridge: 'Brücke',
    tunnel: 'Tunnel',
    'aim.tree': 'Baum: {name}',
    'info.trees': 'Baumkataster',
    'info.structures': 'Brücken &amp; Tunnel',
    'info.loading': 'Lade Gebäudedaten…',
    'info.unavailable': 'Daten nicht verfügbar ({e})',
    'info.none': 'Keine weiteren Daten für dieses Gebäude.',
    'info.district': '{n}. Bezirk',
    'info.asl': 'm ü. A.',
    'info.years': '{n} Jahre',
    'info.attic': 'Dachbodenkataster (BDA)',
    'info.wiki': 'Wien Geschichte Wiki',
    'f.address': 'Adresse',
    'f.built': 'Baujahr',
    'f.period': 'Bauperiode',
    'f.period2': 'Umbau / 2. Periode',
    'f.type': 'Bautyp',
    'f.use': 'Nutzung',
    'f.architect': 'Architekt',
    'f.storeys': 'Geschoße',
    'f.height': 'Höhe',
    'f.ground': 'Geländehöhe',
    'f.conscr': 'Konskriptionsnr.',
    'f.object': 'Objekt',
    'f.roof': 'Dachwerk',
    'f.info': 'Info',
    'f.planted': 'Pflanzjahr',
    'f.age': 'Alter',
    'f.crown': 'Kronendurchmesser',
    'f.trunk': 'Stammumfang',
    'f.location': 'Standort',
    'f.district': 'Bezirk',
    'f.treeNo': 'Baumnummer',
    'f.responsible': 'Zuständig',
    'f.kind': 'Art',
    'f.operator': 'Erhalter',
    'f.objectNo': 'Objektnummer',
    'f.length': 'Länge',
    'kind.tunnel': 'Tunnel / Unterführung',
    'rr.name': 'Wiener Riesenrad',
    'rr.kicker': 'Wahrzeichen',
    'rr.opened': 'Eröffnet',
    'rr.openedVal': '3. Juli 1897',
    'rr.builder': 'Konstrukteur',
    'rr.diameter': 'Raddurchmesser',
    'rr.gondolas': 'Waggons',
    'rr.gondolasVal': '15 (bis 1944: 30)',
    'rr.speed': 'Geschwindigkeit',
    'rr.speedVal': '2,7 km/h, eine Runde in ca. 4 ¼ min',
    'rr.weight': 'Eisenkonstruktion',
    'rr.model': 'Maßstabsgetreues Modell, nicht aus den Stadtdaten. Lage: OpenStreetMap (ODbL), Maße: Wikipedia.',

    'hud.alt': 'Höhe {y} m ü. A.',
    'hud.above': '{h} m über Grund',
    'hud.flying': 'Fliegen',
    'hud.noclip': 'Noclip',
    'hud.speed': 'Tempo',
    'hud.buildings': 'Gebäude',
    'hud.loading': 'Lädt',
    'hud.nonstandard': 'nicht standard',

    'set.title': 'Einstellungen',
    'set.reset': 'Zurücksetzen',
    'set.graphics': 'Grafik',
    'set.movement': 'Bewegung',
    'set.controller': 'Controller',
    'set.touch': 'Touch',
    'set.display': 'Anzeige',
    'set.lang': 'Sprache · Language',
    'set.range': 'Sichtweite',
    'set.range.fmt': 'Gebäude {a} · Sicht {b}',
    'set.range.hint': 'Gebäude, Dächer, Bäume, Brücken, Gelände und POIs. Große Werte brauchen ein schnelles Gerät und eine gute Verbindung.',
    'set.resolution': 'Auflösung',
    'set.resolution.hint': 'Niedriger läuft auf Handys und Tablets flüssiger.',
    'set.fov': 'Sichtfeld',
    'set.speed': 'Fluggeschwindigkeit',
    'set.speed.hint': 'Ändert sich auch mit dem Mausrad oder dem Steuerkreuz ▲ ▼ am Controller.',
    'set.lookSens': 'Blickempfindlichkeit',
    'set.lookSens.hint': 'Maus, Touch und Controller.',
    'set.padInvertY': 'Blick hoch / runter umkehren',
    'set.padSwapUpDown': 'Hoch / runter fliegen tauschen (LT ↔ RT)',
    'set.padSwapSticks': 'Sticks tauschen (links umsehen, rechts bewegen)',
    'set.padDrone': 'FPV-Drohnen-Steuerung',
    'set.padDrone.hint': 'Die Drohne fliegt, wohin sie sich neigt, und richtet sich beim Loslassen wieder waagrecht aus. Links: Schub (Mitte = Höhe halten) / gieren, rechts: nicken / rollen.',
    'set.touchDragView': 'Ansicht ziehen statt Fadenkreuz bewegen',
    'set.touchDragView.hint': 'Wie ein Foto verschieben: die Szene folgt den Fingern, auch beim Fliegen mit zwei Fingern (seitwärts, vor und zurück).',
    'set.touchPinch': 'Zusammenziehen fliegt näher, Auseinanderziehen weg',
    'set.touchPinch.hint': 'Umgekehrt zum Zoomen in Karten-Apps.',
    'set.showStats': 'Koordinaten &amp; Statistik anzeigen (C)',
    'set.showCompass': 'Kompass anzeigen (K)',
    'set.compassCorner': 'Kompass-Position',
    'corner.tl': 'Oben links',
    'corner.tr': 'Oben rechts',
    'corner.bl': 'Unten links',
    'corner.br': 'Unten rechts',
    'compass.n': 'N',
    'compass.e': 'O',
    'compass.s': 'S',
    'compass.w': 'W',
    'set.pad.ok': '✓ Verbunden: {id}',
    'set.pad.none':
      'Kein Controller gefunden. Anstecken oder in den Bluetooth-Einstellungen des Geräts koppeln, dann eine beliebige Taste drücken. Hier muss nichts weiter verbunden werden.',
  },
  en: {
    'menu.sub': 'Open Government Data Vienna &amp; Austria',
    'menu.keyboard': 'Keyboard &amp; mouse',
    'menu.touch': 'Touch',
    'menu.controller': 'Controller',
    'menu.places': 'Places',
    'menu.play': 'Click or tap anywhere or press any key to play',
    'menu.pois': 'Places &amp; POIs',
    'menu.settings': 'Settings',
    'kb.1': '<kbd>W A S D</kbd> move',
    'kb.2': '<kbd>Mouse</kbd> look',
    'kb.3': '<kbd>Space</kbd> fly up · <kbd>Shift</kbd> fly down',
    'kb.4': '<kbd>W</kbd><kbd>W</kbd> / <kbd>R</kbd> sprint',
    'kb.5': '<kbd>Wheel</kbd> speed multiplier',
    'kb.6': '<kbd>N</kbd> noclip (through walls)',
    'kb.7': '<kbd>P</kbd> POI list · <kbd>Click</kbd> info · <kbd>X</kbd>/<kbd>Right-click</kbd> close info',
    'kb.8': '<kbd>M</kbd> mouse mode (free cursor)',
    'kb.9': '<kbd>C</kbd> coordinates &amp; stats · <kbd>K</kbd> compass',
    'kb.esc': '<kbd>Esc</kbd> close box / show this window',
    'touch.1': '<kbd>Drag</kbd> move the crosshair (swipe fast to turn)',
    'touch.1.view': '<kbd>Drag</kbd> move the view (swipe fast to turn)',
    'touch.2': '<kbd>Spread</kbd> fly towards the crosshair',
    'touch.3': '<kbd>Pinch</kbd> back away',
    'touch.2.pinch': '<kbd>Pinch</kbd> fly towards the crosshair',
    'touch.3.spread': '<kbd>Spread</kbd> back away',
    'touch.strafe': '<kbd>2 fingers ◀ ▶</kbd> slide sideways',
    'touch.fwd': '<kbd>2 fingers ▲ ▼</kbd> fly forwards / backwards (like W / S)',
    'touch.fwd.view': '<kbd>2 fingers ▼ ▲</kbd> fly forwards / backwards (like W / S)',
    'touch.4': '<kbd>Tap</kbd> info about what the crosshair points at',
    'touch.5': '<kbd>2-finger tap</kbd> close info / menu',
    'pad.1': '<kbd>{move}</kbd> move · <kbd>{look}</kbd> look{inv}',
    'pad.inverted': ' (up / down inverted)',
    'pad.2': '<kbd>{up}</kbd> up · <kbd>{down}</kbd> down · <kbd>{sprint}</kbd> sprint',
    'pad.1.drone': '<kbd>{thr}</kbd> throttle / yaw · <kbd>{rp}</kbd> pitch / roll{inv}',
    'pad.2.drone': 'Let go of the stick: the drone levels out',
    'pad.3': '<kbd>RB</kbd> info · <kbd>LB</kbd> close · <kbd>Y</kbd> noclip',
    'pad.4': '<kbd>▲</kbd><kbd>▼</kbd> speed · <kbd>◀</kbd><kbd>▶</kbd> places',
    'pad.5': '<kbd>Start</kbd> menu · <kbd>Back</kbd> stats',
    credits:
      'Buildings &amp; trees: Stadt Wien – data.wien.gv.at (CC BY 4.0) · Orthophoto: basemap.at (CC BY 4.0) · Bridges &amp; tunnels: MA 29, ASFINAG, Wiener Linien via data.wien.gv.at · DOM 5 m Stadt Wien · Terrain: DGM Österreich 10 m via AWS Terrain Tiles · Riesenrad model: position © OpenStreetMap contributors (ODbL), dimensions: Wikipedia<br />Source code: <a href="https://github.com/c5e3/wien3d" target="_blank" rel="noopener">github.com/c5e3/wien3d</a> (MIT) · <a id="menu-legal" href="#">Privacy notice &amp; imprint</a>',
    'mouse.hint': 'Mouse mode · <kbd>M</kbd> or click into the scene to keep playing · <kbd>Esc</kbd> menu',
    close: 'Close',
    'close.info': 'Close (X / Esc)',
    'close.settings': 'Close (Esc)',
    'close.poi': 'Close (P / Esc)',
    'legal.title': 'Privacy notice &amp; imprint',
    'legal.body':
      '<h3>Imprint</h3>' +
      '<p>Disclosure under § 25 of the Austrian Media Act (Mediengesetz)<br>Media owner: ***<br>Contact: <a class="mail" href="#"></a></p>' +
      '<p>Wien 3D is a private, non-commercial hobby project with no advertising and no revenue. Content: an interactive 3D map of Vienna built from open government data. No guarantee is given for the accuracy or completeness of the data shown.</p>' +
      '<h3>Privacy notice</h3>' +
      '<p><b>Controller:</b> *** (<a class="mail" href="#"></a>).</p>' +
      '<p>This website uses <b>no cookies, no analytics or tracking services and no advertising</b>. There are no user accounts, and no forms or input are sent to me.</p>' +
      '<p><b>Local storage:</b> your settings (e.g. language, render distance) and which POI groups are expanded are kept only in your browser’s local storage and are never transmitted. You can delete them at any time by clearing this site’s data in your browser.</p>' +
      '<p><b>Technically necessary connections:</b> for the map to work, your browser loads data directly from the following servers. As with any website visit, your IP address is transmitted to the respective provider:</p>' +
      '<ul>' +
      '<li><b>Vercel Inc.</b> (USA): hosting of this website. Vercel processes access data (IP address, time, requested file, browser identifier) to deliver and secure the service.</li>' +
      '<li><b>City of Vienna</b> (data.wien.gv.at, mapsneu.wien.gv.at): building, tree and POI data as well as orthophotos (basemap.at).</li>' +
      '<li><b>Amazon Web Services Inc.</b> (USA, s3.amazonaws.com): terrain elevation (AWS Terrain Tiles).</li>' +
      '</ul>' +
      '<p>The legal basis is my legitimate interest in providing a working website (Art. 6(1)(f) GDPR). Transfers to Vercel and AWS in the USA are based on the EU-US Data Privacy Framework (Art. 45 GDPR). I do not analyse any access data myself. The providers keep it under their own privacy policies only as long as needed for operation and security.</p>' +
      '<p>External links (e.g. to GitHub) are only opened when you click them.</p>' +
      '<p><b>Your rights:</b> you have the right of access, rectification, erasure, restriction of processing and objection (Art. 15–21 GDPR). Just send me an email. You can also lodge a complaint with the Austrian Data Protection Authority (<a href="https://www.dsb.gv.at" target="_blank" rel="noopener">dsb.gv.at</a>).</p>',

    'poi.title': 'Places &amp; POIs (OGD Vienna)',
    'poi.clear': 'All off',
    'poi.search': 'Search… (layer names are German, e.g. Museum, Trinkbrunnen)',
    'poi.loading': 'loading…',
    'poi.shown': '{n} shown',
    'poi.nearby': 'nearby',
    'poi.on': '{n} on',
    'poi.none': 'No matching categories.',

    building: 'Building',
    tree: 'Tree',
    bridge: 'Bridge',
    tunnel: 'Tunnel',
    'aim.tree': 'Tree: {name}',
    'info.trees': 'Tree register',
    'info.structures': 'Bridges &amp; tunnels',
    'info.loading': 'Loading building data…',
    'info.unavailable': 'Data not available ({e})',
    'info.none': 'No further data for this building.',
    'info.district': 'District {n}',
    'info.asl': 'm a.s.l.',
    'info.years': '{n} years',
    'info.attic': 'Attic register (BDA)',
    'info.wiki': 'Vienna History Wiki',
    'f.address': 'Address',
    'f.built': 'Year built',
    'f.period': 'Construction period',
    'f.period2': 'Conversion / 2nd period',
    'f.type': 'Building type',
    'f.use': 'Use',
    'f.architect': 'Architect',
    'f.storeys': 'Storeys',
    'f.height': 'Height',
    'f.ground': 'Ground elevation',
    'f.conscr': 'Conscription no.',
    'f.object': 'Object',
    'f.roof': 'Roof structure',
    'f.info': 'Info',
    'f.planted': 'Year planted',
    'f.age': 'Age',
    'f.crown': 'Crown diameter',
    'f.trunk': 'Trunk circumference',
    'f.location': 'Location',
    'f.district': 'District',
    'f.treeNo': 'Tree number',
    'f.responsible': 'Maintained by',
    'f.kind': 'Type',
    'f.operator': 'Maintained by',
    'f.objectNo': 'Object number',
    'f.length': 'Length',
    'kind.tunnel': 'Tunnel / underpass',
    'rr.name': 'Wiener Riesenrad',
    'rr.kicker': 'Landmark',
    'rr.opened': 'Opened',
    'rr.openedVal': '3 July 1897',
    'rr.builder': 'Engineer',
    'rr.diameter': 'Wheel diameter',
    'rr.gondolas': 'Gondolas',
    'rr.gondolasVal': '15 (30 until 1944)',
    'rr.speed': 'Speed',
    'rr.speedVal': '2.7 km/h, one turn in about 4¼ min',
    'rr.weight': 'Iron structure',
    'rr.model': 'To-scale model, not from the city data. Position: OpenStreetMap (ODbL), dimensions: Wikipedia.',

    'hud.alt': 'Alt {y} m a.s.l.',
    'hud.above': '{h} m above ground',
    'hud.flying': 'Flying',
    'hud.noclip': 'Noclip',
    'hud.speed': 'Speed',
    'hud.buildings': 'Buildings',
    'hud.loading': 'Loading',
    'hud.nonstandard': 'non-standard',

    'set.title': 'Settings',
    'set.reset': 'Reset',
    'set.graphics': 'Graphics',
    'set.movement': 'Movement',
    'set.controller': 'Controller',
    'set.touch': 'Touch',
    'set.display': 'Display',
    'set.lang': 'Sprache · Language',
    'set.range': 'Render distance',
    'set.range.fmt': 'buildings {a} · view {b}',
    'set.range.hint': 'Buildings, roofs, trees, bridges, terrain and POIs. Far settings need a fast device and connection.',
    'set.resolution': 'Resolution',
    'set.resolution.hint': 'Lower is smoother on phones and tablets.',
    'set.fov': 'Field of view',
    'set.speed': 'Flight speed',
    'set.speed.hint': 'Also changes with the mouse wheel or the controller’s d-pad ▲ ▼.',
    'set.lookSens': 'Look sensitivity',
    'set.lookSens.hint': 'Mouse, touch and controller.',
    'set.padInvertY': 'Invert look up / down',
    'set.padSwapUpDown': 'Swap fly up / down (LT ↔ RT)',
    'set.padSwapSticks': 'Swap sticks (look left, move right)',
    'set.padDrone': 'FPV drone controls',
    'set.padDrone.hint': 'The drone flies where it tilts and levels out when you let go. Left: throttle (centre = hold height) / yaw, right: pitch / roll.',
    'set.touchDragView': 'Drag the view instead of the crosshair',
    'set.touchDragView.hint': 'Like moving a photo: the scene follows your fingers, also when flying with two fingers (sideways, forwards and back).',
    'set.touchPinch': 'Pinch to fly closer, spread to back away',
    'set.touchPinch.hint': 'The reverse of zooming in map apps.',
    'set.showStats': 'Show coordinates &amp; stats (C)',
    'set.showCompass': 'Show compass (K)',
    'set.compassCorner': 'Compass position',
    'corner.tl': 'Top left',
    'corner.tr': 'Top right',
    'corner.bl': 'Bottom left',
    'corner.br': 'Bottom right',
    'compass.n': 'N',
    'compass.e': 'E',
    'compass.s': 'S',
    'compass.w': 'W',
    'set.pad.ok': '✓ Connected: {id}',
    'set.pad.none':
      'No controller found. Plug it in or pair it in your device’s Bluetooth settings, then press any button on it. Nothing else to connect here.',
  },
};

// POI list sections are keyed by their German names (categoryFor in poi-icons.js)
const CATEGORIES_EN = {
  'Planung & Geodaten': 'Planning & geodata',
  'Kultur & Tourismus': 'Culture & tourism',
  'Freizeit, Sport & Natur': 'Leisure, sports & nature',
  'Märkte & Gastronomie': 'Markets & food',
  'Gesundheit, Soziales & Wohnen': 'Health, social services & housing',
  'Bildung & Jugend': 'Education & youth',
  'Verkehr & Mobilität': 'Transport & mobility',
  'Umwelt & Energie': 'Environment & energy',
  'Verwaltung & Service': 'Administration & services',
  Sonstiges: 'Other',
};

export const LANGS = { de: 'Deutsch', en: 'English' };
export const browserLang = () => ((navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en');

let lang = browserLang();
export const getLang = () => lang;
export const locale = () => (lang === 'de' ? 'de-AT' : 'en-GB');

/** UI string; {name} placeholders filled from vars. Strings may contain markup (entities, kbd, links). */
export function t(key, vars) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
/** Same as t, as plain text (for textContent and attributes). */
export const tText = (key, vars) => decode(t(key, vars));
const decode = (s) => s.replace(/&amp;/g, '&');

export const categoryName = (cat) => (lang === 'en' ? CATEGORIES_EN[cat] ?? cat : cat);

// maps a data-i18n key to [key, vars], so static texts can follow settings (main.js: control lists)
let resolve = (key) => [key];
export function setResolver(fn) {
  resolve = fn;
  refresh();
}

export function setLang(l) {
  lang = STRINGS[l] ? l : 'en';
  document.documentElement.lang = lang;
  refresh();
}

/** Fills static markup: data-i18n (inner HTML), data-i18n-title / -aria / -placeholder (attributes). */
export function refresh() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(...resolve(el.dataset.i18n));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = tText(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', tText(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = tText(el.dataset.i18nPlaceholder);
}
