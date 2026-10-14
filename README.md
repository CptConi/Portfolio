```
 ███████╗ ██████╗ ██████╗ ████████╗███████╗ ██████╗ ██╗     ██╗ ██████╗
 ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝██╔═══██╗██║     ██║██╔═══██╗
 ██████╗ ██║   ██║██████╔╝   ██║   █████╗  ██║   ██║██║     ██║██║   ██║
 ██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔══╝  ██║   ██║██║     ██║██║   ██║
 ██║     ╚██████╔╝██║  ██║   ██║   ██║     ╚██████╔╝███████╗██║╚██████╔╝
 ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝      ╚═════╝ ╚══════╝╚═╝ ╚═════╝

           ▄▄▄·▄▄▄        • ▌ ▄ ·.     ▄▄▄ .▄▄▄·▄▄· ▄ .▄
          ▐█ ▄█▀▄ █·▪     ·██ ▐███▪    ▀▄.▀·▐█ ▄█▐█ ▌▪██▪▐█
           ██▀·▐▀▀▄  ▄█▀▄ ▐█ ▌▐▌▐█·    ▐▀▀▪▄ ██▀·██ ▄▄██▀▐█
          ▐█▪·•▐█•█▌▐█▌.▐▌██ ██▌▐█▌    ▐█▄▄▌▐█▪·•▐███▌██▌▐▀
          .▀   .▀  ▀ ▀█▄▀▪▀▀  █▪▀▀▀     ▀▀▀ .▀   ·▀▀▀ ▀▀▀ ·
```

# Portfolio — DOOM Edition 🔫

> Pas un CV : un **niveau**. Chargez votre plasma gun (enfin, votre tasse de café) et explorez mon travail à la première personne.

Portfolio de **Nicolas Renard**, Lead Developer Full Stack à la Digital Factory de Guaraní (Bordeaux), repensé comme un **FPS Doom-style** rendu en temps réel.
Au lieu de scroller une page, on marche dans un atrium, on lit les bornes, on croise les missions sur leurs socles, on valide quatre cas de test, et on découvre quelques secrets.

```
   ╔════════════════════════════════════════════════════════════╗
   ║  WASD / ZQSD / FLÈCHES · bouger     SOURIS · viser         ║
   ║  E / ESPACE · interagir             TACTILE · joystick     ║
   ║  C contact · M plan · R rapport · V visite · HOME : niveau ║
   ╚════════════════════════════════════════════════════════════╝
```

La version texte, lisible sans WebGL et imprimable, est sur [`/dossier.html`](dossier.html).

---

## ⚙️ Stack

| Brique        | Tech                                                 |
|---------------|------------------------------------------------------|
| Moteur 3D     | [Three.js](https://threejs.org) `0.184`              |
| Build / Dev   | [Vite](https://vitejs.dev) `5`                       |
| Assets        | textures + sprites Freedoom ; tout le reste est procédural |
| Mesure        | [Umami](https://umami.is) auto-hébergé, sans cookie  |
| Deploy        | Vercel                                               |

Vanilla JS, modules ES, zéro framework UI. Moteur maison : map, sprites, props 3D, consoles-canvas, fonctionnalités branchables.

---

## 🗺️ Ce qu'il y a dans le niveau

- 🏛️ **Atrium** — hall cathédrale, trois portiques signalés (CAPACITÉS, SUCCÈS, IDENTITÉ et CONTACT), tableau de bord de la Digital Factory, hologramme-jauge de recette
- 🛠️ **Armurerie** (CAPACITÉS) — les compétences, une rangée de racks par famille
- 🏆 **Trophées** (SUCCÈS) — les missions phares sur leurs socles, avec une maquette 3D par mission, et toutes les missions dans la borne
- 🛋️ **Quartiers** (IDENTITÉ, CONTACT) — profil, passions et contact, dans un salon qui a l'air habité
- 📋 **Rapport de recette** — vous êtes le testeur : quatre cas de test à valider, un rapport (touche R) qui tient le compte, des secrets facultatifs
- 🗒️ **Notes** — des post-its, plaques, étiquettes et autres mots laissés dans le niveau, à lire sur demande (E) : rien ne s'affiche tout seul
- 🌕 **Fenêtres sur la Lune** — chaque salle donne sur l'extérieur : sol lunaire, horizon et Terre au loin ; une verrière dans l'atrium (levez les yeux : souris, PgUp / PgDn, Home pour redresser)
- 🎬 **Arrivée** — une courte séquence pose le décor de la recette, passable à tout moment
- 🎥 **Visite guidée** de 40 secondes, annulable à tout moment
- 📱 **Mobile** — joystick analogique, boutons contextuels, rendu à la résolution de l'appareil

---

## 🚀 Lancer en local

```bash
npm install         # install deps
npm run dev          # vite dev server → http://localhost:3000
npm run build        # build prod → dist/
npm run preview      # preview build prod
```

En développement uniquement, `http://localhost:3000/?autostart&at=12.5,15.4,270` saute l'écran-titre (ajoutez `&intro` pour garder la séquence d'arrivée), et la console du navigateur expose `__game` :

```js
__game.tp(x, z, degrés)        // téléporte le joueur (270 = nord)
__game.open('projects', 3)     // ouvre une borne sur une page
__game.tour.start()            // lance la visite guidée
__game.intro.play()            // rejoue la séquence d'arrivée
__game.recette.validate(4)     // valide les quatre cas de test
```

`lab/dioramas.html` (dev seulement) affiche les maquettes de missions côte à côte.

---

## 📂 Architecture

```
src/
├── main.js              # boot du moteur + boucle
├── engine/              # moteur maison
│   ├── Renderer.js · PostFX.js · Map.js · Player.js · Input.js
│   ├── ScreenManager.js · Screens.js      # consoles interactives
│   ├── Decor.js + decor/                  # décor par zone (atrium, galerie, armurerie…)
│   ├── dioramas/ · props/                 # maquettes de missions, mobilier procédural
│   ├── layout.js                          # positions partagées entre modules
│   └── Events.js · Analytics.js · prefs.js
├── features/            # fonctionnalités branchables (create(ctx) → update(frame))
│   └── shell · intro · notes · recette · tour · gallery · mood · fx · …
├── ui/                  # HUD, mains, tactile, consoles-canvas, arcade
├── data/                # contenu : missions, compétences, passions, contact, notes
├── dossier/             # page texte pré-rendue au build
└── styles/
```

Les missions vivent dans `src/data/projects.js` (dates, accroche, statut, projet phare, image optionnelle : 16:9, WebP, ≤ 40 Ko dans `public/missions/`).

---

## 🙏 Crédits

Textures et sprites : [Freedoom](https://freedoom.github.io) (BSD). Police : [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (OFL). Logos : [devicon](https://devicon.dev) (MIT) et [Simple Icons](https://simpleicons.org) (CC0).

---

```
        ▄█▀▀▀▀▀█▄   "Rip and tear... through my résumé."
       █▀  ▄ ▄  ▀█
       █   ▀▀▀   █          — Nicolas Renard
        ▀▄▄▄▄▄▄▄▀
```

*MIT · Built with caffeine & shotgun shells.*
