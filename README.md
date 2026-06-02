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

> Pas un site. Un **niveau**. Charge ton plasma gun et explore mon CV à la première personne.

Portfolio personnel de **Nicolas Renard**, repensé comme un **FPS Doom-style** rendu en temps réel.
Au lieu de scroller une page, tu **marches dans un atrium 3D**, tu lis les bornes terminal, tu joues à l'arcade, et tu découvres projets, compétences et passions comme des secrets dans une map.

```
   ╔══════════════════════════════════════════════════════╗
   ║  WASD / FLÈCHES  ·  bouger        SOURIS  ·  viser     ║
   ║  E / CLIC        ·  interagir     TACTILE ·  joystick  ║
   ╚══════════════════════════════════════════════════════╝
```

---

## ⚙️ Stack

| Brique        | Tech                                     |
|---------------|------------------------------------------|
| Moteur 3D     | [Three.js](https://threejs.org) `0.184`  |
| Build / Dev   | [Vite](https://vitejs.dev) `5`           |
| Assets        | textures + sprites style WAD Freedoom    |
| Deploy        | Vercel                                   |

Vanilla JS, ES modules, zéro framework UI. Moteur maison : maps, sprites 2D, props 3D, pushwalls, écrans terminal.

---

## 🗺️ Ce qu'il y a dans la map

- 🏛️ **Atrium central** — hall lit avec verticalité, table centrale, signalétique
- 🕹️ **Borne arcade** — minigame jouable dans le niveau
- 💻 **Bornes terminal** — projets, expériences, compétences techniques
- 👋 **Hands & HUD** — vue FPS complète, mains animées, HUD style Doom
- 📱 **Contrôles tactiles** — joystick analogique + boutons, mobile-ready
- 🧱 **Décor level-design** — palette, seuils éclairés, lignes de guidage Black-Mesa

---

## 🚀 Lancer en local

```bash
npm install         # install deps
npm run dev          # vite dev server → http://localhost:5173
npm run build        # build prod → dist/
npm run preview      # preview build prod
```

---

## 📂 Architecture

```
src/
├── main.js              # entrypoint — boot moteur + boucle
├── engine/              # moteur maison
│   ├── Renderer.js      # rendu Three.js
│   ├── Map.js           # géométrie du niveau
│   ├── Player.js        # déplacement + collisions
│   ├── Input.js         # clavier / souris
│   ├── Sprites2D.js     # sprites style Doom
│   ├── Props3D.js       # props 3D
│   ├── PushWall.js      # murs secrets
│   ├── Decor.js         # couche déco / level-design
│   ├── TextureManager.js
│   └── ScreenManager.js · Screens.js
├── ui/                  # interface joueur
│   ├── HUD.js · Hands.js · Touch.js
│   ├── TerminalScreen.js
│   └── ArcadeGame.js    # minigame arcade
├── data/                # contenu portfolio
│   └── projects.js · skills.js · tech.js · passions.js
└── styles/main.css
```

---

```
        ▄█▀▀▀▀▀█▄   "Rip and tear... through my résumé."
       █▀  ▄ ▄  ▀█
       █   ▀▀▀   █          — Nicolas Renard
        ▀▄▄▄▄▄▄▄▀
```

*MIT · Built with caffeine & shotgun shells.*
