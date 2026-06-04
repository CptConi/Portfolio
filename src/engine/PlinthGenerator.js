import { projects } from '../data/projects.js';

/**
 * Génère dynamiquement les positions des socles en fonction du nombre de projets.
 * Répartit les projets sur les murs Nord et Sud de la salle des trophées.
 */
export function getDynamicPlinths() {
  const plinths = [];
  // Zone de la salle TROPHÉES dans Map.js : x de 17 à 23, z de 9 à 16
  // On laisse une marge pour ne pas coller aux murs Est/Ouest
  const minX = 17.7;
  const maxX = 21.8;
  const northZ = 9.6;
  const southZ = 15.4;

  const total = projects.length;
  if (total === 0) return [];

  const half = Math.ceil(total / 2);

  for (let i = 0; i < total; i++) {
    const isNorth = i < half;
    const sideCount = isNorth ? half : (total - half);
    const indexInSide = isNorth ? i : (i - half);

    let x;
    if (sideCount === 1) {
      x = (minX + maxX) / 2;
    } else {
      const spacing = (maxX - minX) / (sideCount - 1);
      x = minX + (indexInSide * spacing);
    }

    plinths.push({
      x: Number(x.toFixed(2)),
      z: isNorth ? northZ : southZ,
      face: isNorth ? [0, 1] : [0, -1]
    });
  }

  return plinths;
}
