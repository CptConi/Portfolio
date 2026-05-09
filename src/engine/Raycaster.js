import { MAP, MAP_WIDTH, MAP_HEIGHT } from './Map.js';

// DDA raycasting — returns hit info for one ray
export function castRay(px, py, angle) {
  const rdx = Math.cos(angle);
  const rdy = Math.sin(angle);

  let mapX = Math.floor(px);
  let mapY = Math.floor(py);

  const ddx = Math.abs(1 / rdx);
  const ddy = Math.abs(1 / rdy);

  let stepX, stepY, sideDistX, sideDistY;

  if (rdx < 0) { stepX = -1; sideDistX = (px - mapX) * ddx; }
  else          { stepX =  1; sideDistX = (mapX + 1 - px) * ddx; }

  if (rdy < 0) { stepY = -1; sideDistY = (py - mapY) * ddy; }
  else          { stepY =  1; sideDistY = (mapY + 1 - py) * ddy; }

  let side, wallType;
  let maxSteps = MAP_WIDTH + MAP_HEIGHT;

  while (maxSteps-- > 0) {
    if (sideDistX < sideDistY) {
      sideDistX += ddx;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += ddy;
      mapY += stepY;
      side = 1;
    }

    if (mapX < 0 || mapX >= MAP_WIDTH || mapY < 0 || mapY >= MAP_HEIGHT) {
      wallType = 1;
      break;
    }

    wallType = MAP[mapY][mapX];
    // Treat trigger floors (2,3,4) as floor — ray continues through them
    if (wallType === 1) break;
    if (wallType > 1) {
      // entering a trigger room — cast as specific wall type for color variety
      // but continue ray; only stop at actual wall (1) or room boundaries
    }
  }

  const perpWallDist = side === 0
    ? (mapX - px + (1 - stepX) / 2) / rdx
    : (mapY - py + (1 - stepY) / 2) / rdy;

  // Wall texture X coordinate (0-1)
  let wallX = side === 0
    ? py + perpWallDist * rdy
    : px + perpWallDist * rdx;
  wallX -= Math.floor(wallX);

  return { perpWallDist, wallX, side, wallType, mapX, mapY };
}
