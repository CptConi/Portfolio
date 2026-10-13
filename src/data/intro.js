// The arrival sequence: what the opening says, in the order it says it (features/intro.js plays it).
//
// Copy: the writers' room final cut (`arrival` in copy-final.json), word for word. It already carries
// its French typography (a no-break space before : ; ? ! » and after «, so a colon never starts a
// line); fr() keeps it that way if a line is edited later with an ordinary space.
//
//   beat     1-based order
//   camera   where the view rests while the beat is on; the heading itself is worked out by the
//            feature from the level: 'spawn' (the opening look, north), 'west' and 'east' (the
//            CAPACITÉS and SUCCÈS signs over the side doors), 'north' (the IDENTITÉ, CONTACT sign),
//            'center' (the hub, the gauge of the report)
//   voice    'systeme' (CAPS, Doom-style status line) | 'nicolas' (first person, dry)
//   hint     optional, announced to the other modules with the beat: 'rapport' = the RECETTE chip
//   cue      optional, drawn by the intro itself while the beat is on: 'mug' = a glow on the mug
//   touch    optional, the text to use on a touch screen when the line names a key that is not there
//            (beat 6: no R key, the RECETTE chip top right is the way in, as the first-validation toast
//            of features/recette.js says). Only the key reference is swapped; the rest of the sentence
//            is the writers' own. To be signed off by the writers: dropping the field restores the
//            desktop line everywhere.
const NB = '\u00a0';
const fr = text => text.replace(/ ([:;?!»])/g, `${NB}$1`).replace(/(«) /g, `$1${NB}`);

export const arrival = [
  {
    beat: 1,
    camera: 'spawn',
    voice: 'systeme',
    text: fr('TICKET #1337 : PORTFOLIO EN RECETTE. TESTEUR COMMIS D\'OFFICE : VOUS.'),
  },
  {
    beat: 2,
    camera: 'west',
    voice: 'systeme',
    text: fr('CAS 1/4 : CAPACITÉS. CRITÈRE : OUVRIR LA CONSOLE.'),
  },
  {
    beat: 3,
    camera: 'east',
    voice: 'systeme',
    text: fr('CAS 2/4 : SUCCÈS. CRITÈRE : IDEM.'),
  },
  {
    beat: 4,
    camera: 'north',
    voice: 'systeme',
    text: fr('CAS 3/4 : IDENTITÉ. PIÈCES JOINTES : GUITARE, BARBECUE, CHATS.'),
  },
  {
    beat: 5,
    camera: 'north',
    voice: 'nicolas',
    text: fr('Cas 4/4 : contact. Écrire est facultatif.'),
  },
  {
    beat: 6,
    camera: 'center',
    voice: 'systeme',
    text: fr('TOUCHE R : LE RAPPORT TIENT LE SCORE. VOUS N\'AVEZ RIEN À RÉDIGER.'),
    touch: fr('EN HAUT À DROITE : LE RAPPORT TIENT LE SCORE. VOUS N\'AVEZ RIEN À RÉDIGER.'),
    hint: 'rapport',
  },
  {
    beat: 7,
    camera: 'spawn',
    voice: 'nicolas',
    text: fr('Votre arme : ma tasse. À rendre en fin de recette. Allez-y.'),
    cue: 'mug',
  },
];
