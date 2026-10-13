// Mission registry — single source of truth for the Trophées gallery plinths
// and the MISSIONS.LOG console.
//
//  start / end : 'YYYY' or 'YYYY-MM'; end === null means the mission is ongoing.
//  tagline     : one-line hook, 50 characters max.
//  featured    : also shown as a 3D trophy in the gallery (every mission stays
//                reachable in the console).
//  df          : true for every mission carried out at the Digital Factory of Guaraní.
//                Those missions, and only those, are the rows of the DIGITAL FACTORY //
//                STATUS.LOG console (earlier jobs and side projects never appear there).
//  status      : Digital Factory missions only (df: true). Where the mission stands in the
//                Digital Factory lifecycle:
//                { phase: 'conception' | 'build' | 'run' | 'archive',
//                  note : short French detail, 34 characters max,
//                  line : optional dry French sentence, shown on the ARCHIVE page }
//                'run' means in production, 'archive' means the service is decommissioned.
//                Only claim 'run' for what is really live: a mission that is not in production
//                yet stays 'conception' or 'build'.
//  image       : optional path '/missions/<name>.webp' (file in public/missions/): a 16:9
//                screenshot, 640x360, WebP, 40 KB max. The mission page draws it as a
//                ~112x63 thumbnail once it has loaded; a missing or broken file is
//                silently ignored. Not set on any mission yet.
//
// Missions are listed in no particular order here: `projects` below is sorted
// (ongoing first, then by end date, most recent first), so the console pages and
// the gallery plinths always agree.

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const fmtDate = d => { const [y, m] = d.split('-'); return m ? `${MONTHS[+m - 1]} ${y}` : y; };

// 'YYYY' sorts after every month of that year (month defaults to 12).
const dateKey = d => { const [y, m = '12'] = d.split('-'); return +y * 100 + +m; };
const endKey = p => (p.end === null ? Infinity : dateKey(p.end));

// Human-readable period, e.g. "déc. 2025 - en cours", "2024 - janv. 2026", "2023".
export function periodLabel({ start, end }) {
  if (end === null) return `${fmtDate(start)} - en cours`;
  if (end === start) return fmtDate(start);
  return `${fmtDate(start)} - ${fmtDate(end)}`;
}

// Short labels summarising a mission, all derived from its data (never stored):
// status first, then the role, then whether something is reachable online.
export function badgesOf({ end, role, url }) {
  const badges = [];
  if (end === null) badges.push('EN COURS');
  if (/\blead\b/i.test(role)) badges.push('LEAD');
  if (/\barchitecte\b/i.test(role)) badges.push('ARCHITECTE');
  if (/\bsolo\b/i.test(role)) badges.push('SOLO');
  if (url) badges.push('EN LIGNE');
  return badges;
}

const MISSIONS = [
  {
    name: 'PHENIX FORMATION',
    client: 'Phenix Formation / Guaraní',
    start: '2026-08',
    end: null,
    stack: ['Angular', 'NestJS', 'Apache Pulsar', 'PostgreSQL', 'CleverCloud'],
    role: 'Lead Developer & Architecte',
    tagline: 'Trois apps en une, 3 000 formations par an.',
    description: 'Courtage de formation : organismes et formateurs, trois apps en une (acceptation, matchmaking, calendriers, notifications). ~3 000 formations par an, aujourd\'hui sur WhatsApp et Excel. Hébergement CleverCloud (UE). En conception. Plus gros projet de la Digital Factory à date.',
    tags: ['Plateforme', 'Architecture', 'Données UE'],
    df: true,
    status: { phase: 'conception', note: 'Plus gros projet de la DF à date' },
    featured: true,
  },
  {
    name: 'NEEMBA THEBRIDGE',
    client: 'Neemba (filiale de Caterpillar) / Guaraní',
    start: '2026-04',
    end: null,
    stack: ['Svelte 5', 'Go Fiber', 'Kafka', 'PostgreSQL'],
    role: 'Lead Developer & Architecte',
    tagline: 'Relier SAP Ariba à l\'ERP IRIUM.',
    description: 'Pont entre SAP Ariba (commandes d\'un client de Neemba) et l\'ERP IRIUM : suivi, contrôle et bon déroulé des commandes, moins de traitements longs, fastidieux et sujets aux erreurs. Microservices. Infra en partie côté Neemba (cloud, on-premise prévu). Pas encore en prod.',
    tags: ['Architecture', 'Microservices', 'ERP'],
    df: true,
    status: { phase: 'build', note: 'Pas encore en production' },
    featured: true,
  },
  {
    name: 'TBE',
    client: 'TBE / Guaraní',
    start: '2025-12',
    end: null,
    stack: ['Ionic', 'Capacitor', 'Angular', '.NET Core'],
    role: 'Lead Developer',
    tagline: 'Chaque mise en bouteille suivie, casse incluse.',
    description: 'Suivi des mises en bouteille mobiles (camions équipés dans les domaines viticoles) : temps, traitements, casse, satisfaction. Accompagnement au déploiement (iOS Ad Hoc), doc pour l\'autonomie du client. Depuis mars 2026 : montée de version Angular 20 / .NET Core 8, mise en prod simultanée app iOS, admin, API.',
    tags: ['Mobile', 'Terrain', 'Migration'],
    df: true,
    status: { phase: 'run', note: 'Montée de version en cours' },
    featured: true,
  },
  {
    name: 'IRUN',
    client: 'Irun / Guaraní',
    start: '2025-12',
    end: null,
    stack: ['Vue 3', 'Java Spring', 'PostgreSQL'],
    role: 'Lead Developer',
    tagline: 'Les mouvements de stock, sur Zebra.',
    description: 'PWA (Vue 3 SSR) sur Zebra pour les mouvements de stock de l\'entrepôt d\'une enseigne de vêtements de sport. Utilisateur : le préparateur de commandes. Conception et documentation technico-fonctionnelle rédigées en amont, avec précision. V1.1 en prod, V1.2 en cours.',
    tags: ['PWA', 'Logistique', 'Retail'],
    df: true,
    status: { phase: 'run', note: 'V1.1 en prod, V1.2 en build' },
    featured: true,
  },
  {
    name: 'MAISON LA MAUNY',
    client: 'Maison La Mauny / Guaraní',
    start: '2025-12',
    end: '2026-01',
    stack: ['Ionic', 'Electron', 'Strapi'],
    role: 'Lead Developer',
    tagline: 'Quand repart le petit train ? Demandez à l\'écran.',
    description: 'Maintenance évolutive d\'une app affichée sur un écran de 55 pouces à l\'entrée de l\'usine : rhums, procédés, histoire de la maison, retour à quai du petit train touristique. Mise à jour de visuels, retrait de quelques recettes, build, déploiement. Conçue à l\'origine par la Digital Factory.',
    tags: ['Affichage d\'accueil', 'Maintenance évolutive'],
    df: true,
    status: { phase: 'run', note: 'Maintenance évolutive' },
  },
  {
    name: 'LOOT LURKER',
    client: 'Projet Personnel / Édition Automatisée',
    start: '2026',
    end: '2026',
    stack: ['Next.js', 'Node.js', 'Python', 'n8n', 'Umami', 'Docker', 'TikTok API', 'Instagram API', 'YouTube API'],
    role: 'Architecte Solution & Lead Developer',
    tagline: 'Traque d\'erreurs de prix, en pilote automatique.',
    description: 'Plateforme automatisée de curation de deals gaming et d\'erreurs de prix pour jeux PC (Steam, Instant Gaming). Analyse automatisée via algorithme de notation, génération de médias et publication croisée cross-canal en temps réel. Terminé et en production.',
    tags: ['Automatisation', 'Gaming', 'Growth Hacking', 'Privacy-First'],
  },
  {
    name: 'OVIEPRO',
    client: 'Onelaw / Guaraní',
    start: '2025',
    end: '2025',
    stack: ['React', 'Node.js', 'NestJS', 'PostgreSQL'],
    role: 'Lead Developer',
    tagline: 'Le suivi des arrêts maladie, sans paperasse.',
    description: 'Plateforme de gestion des arrêts maladie et maladies professionnelles pour grands comptes. Workflow complet de suivi documentaire avec interfaces multi-profils.',
    tags: ['SaaS', 'Workflow', 'Multi-profils'],
    df: true,
    status: { phase: 'run', note: 'Grands comptes, multi-profils' },
    featured: true,
  },
  {
    name: 'MYCLOUDTAXI',
    client: 'ATA / Guaraní',
    start: '2025',
    end: '2025',
    stack: ['Flutter', 'Dart', 'Firebase', 'WebSocket'],
    role: 'Lead Developer',
    tagline: 'Deux natifs en un seul Flutter.',
    description: 'Refonte complète de l\'app chauffeur. Migration native → Flutter unifié. Focus UX, stabilité et qualité code. Collaboration backend pour challenger les API existantes.',
    tags: ['Mobile', 'Flutter', 'Refonte'],
    url: 'https://play.google.com/store/apps/details?id=com.cloudtaxi.driver',
    df: true,
    status: { phase: 'run', note: 'Sur le Play Store' },
  },
  {
    name: 'HEARTSIDE',
    client: 'Heartside',
    start: '2025',
    end: '2025',
    stack: ['Node.js', 'Flutter', 'Unity VR', 'NestJS'],
    role: 'Lead Developer',
    tagline: 'Casque VR d\'un côté, microservices de l\'autre.',
    description: 'Expérience VR immersive. Backend microservice de calcul artistique, app mobile iOS/Android, back-office, coordination multi-pôles (VR/mobile/backend).',
    tags: ['VR', 'Mobile', 'Microservices'],
    url: 'https://apps.apple.com/fr/app/heartside/id6477892440',
    df: true,
    status: { phase: 'run', note: 'Sur l\'App Store' },
    featured: true,
  },
  {
    name: '1001TAXIS',
    client: 'ATA / Guaraní',
    start: '2024',
    end: '2024',
    stack: ['Flutter', 'Firebase', 'Google Maps API', 'Fastlane'],
    role: 'Lead Developer',
    tagline: 'De zéro aux stores, iOS et Android.',
    description: 'App passagers développée from scratch. Déploiement complet iOS + Android, pipelines CI/CD industrialisés, soumission stores.',
    tags: ['Mobile', 'Flutter', 'CI/CD'],
    url: 'https://apps.apple.com/fr/app/1001taxis/id1597454600',
    df: true,
    status: { phase: 'run', note: 'Sur l\'App Store' },
    featured: true,
  },
  {
    name: 'PARFUMERIE PRIVÉE',
    client: 'Parfumerie Privée (Groupe Novi) / Guaraní',
    start: '2024',
    end: '2026-01',
    stack: ['Angular', 'Strapi', 'Azure DevOps', 'Node.js'],
    role: 'Lead Developer',
    tagline: 'Strapi 5, Node 22, Angular 19 : tout à jour.',
    description: 'Refonte e-commerce complète en 2024 (front, back, CMS) : conformité DIOR, pages marques configurables, headless. Nov. 2025 - janv. 2026 : Strapi 4 vers 5, Node 16 vers 22, Angular 16 vers 19. Site fermé depuis par le groupe Novi (décision stratégique).',
    tags: ['E-commerce', 'Headless CMS', 'Migration'],
    df: true,
    status: {
      phase: 'archive',
      note: 'Décision stratégique du groupe',
      line: 'A quitté la production avec ses dépendances à jour : Strapi 5, Node 22, Angular 19.',
    },
    featured: true,
  },
  {
    name: 'SOURCINN CRM',
    client: 'Sourcinn',
    start: '2024',
    end: '2024',
    stack: ['Angular 17', 'NestJS', 'PostgreSQL', 'Azure'],
    role: 'Lead Developer',
    tagline: 'Angular Signals, guide d\'équipe inclus.',
    description: 'Application CRM logistique Angular 17. Mise en œuvre des Angular Signals, conception guide de développement équipe, montée en compétence collective.',
    tags: ['CRM', 'Angular Signals', 'Leadership'],
    df: true,
    status: { phase: 'run', note: 'CRM logistique, Angular 17' },
  },
  {
    name: 'INTERCEPTION POINT',
    client: 'Game Jam',
    start: '2024',
    end: '2024',
    stack: ['C#', 'MonoGame'],
    role: 'Développeur solo',
    tagline: 'Snake rencontre Tron, en 2 semaines.',
    description: 'Party game 4 joueurs inspiré de Snake/Tron. Développé en 2 semaines lors d\'une Game Jam. Disponible sur itch.io.',
    tags: ['Jeu vidéo', 'C#', 'Game Jam'],
    url: 'https://cptconi.itch.io/grid-gc-gj24',
  },
  {
    name: 'SAAS PARCAGE VÉHICULES',
    client: 'Elazur (via Guaraní)',
    start: '2023',
    end: '2023',
    stack: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
    role: 'Développeur Full Stack',
    tagline: 'Où garer un bus ? Le SaaS a la réponse.',
    description: 'Solution SaaS from scratch pour optimiser la gestion de parcage de flotte véhicule dans les dépôts — transports genevois.',
    tags: ['SaaS', 'React', 'From scratch'],
    df: true,
    status: { phase: 'run', note: 'Dépôts de transports genevois' },
  },
  {
    name: 'HIGHVIEW 3',
    client: 'Madic Digital',
    start: '2021',
    end: '2022',
    stack: ['Angular', 'Node.js', 'Power BI', 'Azure', 'GitLab'],
    role: 'Développeur Frontend',
    tagline: 'Des écrans partout, un seul poste de pilotage.',
    description: 'Solution d\'administration et de monitoring de flottes de digital signage (Stellantis, BNP...). Pilotage à distance et supervision temps réel.',
    tags: ['Monitoring', 'Digital Signage', 'Angular'],
  },
];

// Ongoing missions first (newest start first), then by end date, most recent first.
// Array#sort is stable, so ties keep the order above.
export const projects = [...MISSIONS].sort(
  (a, b) => (endKey(b) - endKey(a)) || (dateKey(b.start) - dateKey(a.start)),
);

// Missions shown as 3D trophies in the gallery (same order as the console).
export const featuredProjects = projects.filter(p => p.featured);
