// Tech registry shared by the 3D trophy logos (Decor) and the mainframe console
// (TerminalScreen). Each entry: dominant brand colour `c`, and either a real logo
// file `f` (public/logos/<f>.svg, fetched from devicon) or a short text label `l`
// used as a fallback when no logo exists.
export const TECH = {
  // Languages
  'JavaScript':        { c: 0xf7df1e, f: 'javascript' },
  'TypeScript':        { c: 0x3aa0f0, f: 'typescript' },
  'C#':                { c: 0xbe6ec1, f: 'csharp' },
  'C++':               { c: 0x00599c, f: 'cplusplus' },
  'Dart':              { c: 0x2cb8f7, f: 'dart' },
  'Lua':               { c: 0x6f80c6, f: 'lua' },
  'HTML5':             { c: 0xe34f26, f: 'html5' },
  'CSS3':              { c: 0x2965f1, f: 'css3' },
  'GraphQL':           { c: 0xe535ab, f: 'graphql' },
  'YAML':              { c: 0xff6e6e, f: 'yaml' },
  'Python':            { c: 0x3776ab, f: 'python' },
  // Frontend
  'React':             { c: 0x61dafb, f: 'react' },
  'Vue.js':            { c: 0x42b883, f: 'vuejs' },
  'Angular':           { c: 0xdd0031, f: 'angular' },
  'Angular 17':        { c: 0xdd0031, f: 'angular' },
  'Svelte':            { c: 0xff3e00, f: 'svelte' },
  'Ionic':             { c: 0x3880ff, f: 'ionic' },
  'Bootstrap':         { c: 0x7952b3, f: 'bootstrap' },
  'SASS':              { c: 0xcc6699, f: 'sass' },
  'Styled Components': { c: 0xdb7093, f: 'styled' },
  'Chart.js':          { c: 0xff6384, f: 'chartjs' },
  'GSAP':              { c: 0x88ce02, f: 'greensock' },
  'Vite':              { c: 0x9b6cf2, f: 'vitejs' },
  'Next.js':           { c: 0xffffff, f: 'nextjs' },
  // Backend
  'Node.js':           { c: 0x68a063, f: 'nodejs' },
  'Express.js':        { c: 0xcccccc, f: 'express' },
  'NestJS':            { c: 0xe0234e, f: 'nestjs' },
  'Socket.io':         { c: 0xdddddd, f: 'socketio' },
  'WebSocket':         { c: 0x37c0ff, l: 'WS' },
  'n8n':               { c: 0xea4b71, f: 'n8n' },
  'Strapi':            { c: 0x8e75ff, f: 'strapi' },
  'JWT':               { c: 0xd63aff, f: 'jwt' },
  'RxJS':              { c: 0xe6007e, f: 'rxjs' },
  // Mobile
  'Flutter':           { c: 0x47c5fb, f: 'flutter' },
  'Capacitor':         { c: 0x53b9ff, f: 'capacitor' },
  'Fastlane':          { c: 0x9ccb3b, f: 'fastlane' },
  'Firebase':          { c: 0xffca28, f: 'firebase' },
  'Firebase / Firestore': { c: 0xffca28, f: 'firebase' },
  'Unity VR':          { c: 0xdddddd, f: 'unity' },
  // Databases
  'MongoDB':           { c: 0x4ea94b, f: 'mongodb' },
  'MySQL':             { c: 0x4479a1, f: 'mysql' },
  'PostgreSQL':        { c: 0x4d82bc, f: 'postgresql' },
  'SQL':               { c: 0xe38c00, l: 'SQL' },
  'Amazon S3':         { c: 0xe25444, f: 'aws' },
  // Cloud / DevOps
  'AWS':               { c: 0xff9900, f: 'aws' },
  'Azure':             { c: 0x2aa3ef, f: 'azure' },
  'Azure DevOps':      { c: 0x2aa3ef, f: 'azure' },
  'GitLab':            { c: 0xfca326, f: 'gitlab' },
  'Docker':            { c: 0x2496ed, f: 'docker' },
  'GitHub Actions':    { c: 0x2088ff, f: 'githubactions' },
  'CI/CD':             { c: 0x33cc99, l: 'CI/CD' },
  // Tools
  'Git':               { c: 0xf05033, f: 'git' },
  'Jest':              { c: 0xc21325, f: 'jest' },
  'Sentry':            { c: 0xb889ff, f: 'sentry' },
  'OpenTelemetry':     { c: 0xf5a800, f: 'otel' },
  'Swagger':           { c: 0x85ea2d, f: 'swagger' },
  'Stripe':            { c: 0x8c87ff, f: 'stripe' },
  'Power BI':          { c: 0xf2c811, f: 'powerbi' },
  'Umami':             { c: 0x24a0ed, f: 'umami' },
  // Misc
  'Google Maps API':   { c: 0x4caf6a, f: 'googlemaps' },
  'YouTube API':      { c: 0xff0000, f: 'youtube' },
  'TikTok API':        { c: 0x25f4ee, f: 'tiktok' },
  'Instagram API':     { c: 0xe4405f, f: 'instagram' },
  'MonoGame':          { c: 0xe73c00, f: 'monogame' },
};

export const techOf = name => TECH[name] || { c: 0xff8c00, l: name.slice(0, 6).toUpperCase() };
