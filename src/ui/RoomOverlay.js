import { skills } from '../data/skills.js';
import { projects } from '../data/projects.js';
import { passions } from '../data/passions.js';
import { ROOMS } from '../engine/Map.js';

export class RoomOverlay {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.id = 'room-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);

    this._currentRoom = null;

    document.addEventListener('keydown', e => {
      if (e.code === 'Escape' && this.isOpen()) this.close();
    });
  }

  isOpen() { return this.el.style.display !== 'none'; }

  open(roomType) {
    this._currentRoom = roomType;
    const room = ROOMS[roomType];
    const color = room.color;

    let content = '';
    if (roomType === 2) content = this._buildSkills(color);
    if (roomType === 3) content = this._buildProjects(color);
    if (roomType === 4) content = this._buildPassions(color);

    this.el.innerHTML = `
      <div class="overlay-inner" style="border-color: ${color}; box-shadow: 0 0 30px ${color}44">
        <div class="overlay-header" style="color: ${color}">
          <span class="overlay-scanline">▓▓▓</span>
          ${room.name}
          <span class="overlay-scanline">▓▓▓</span>
        </div>
        <div class="overlay-close" style="color: ${color}">[ ESC ] FERMER</div>
        <div class="overlay-content">${content}</div>
      </div>
    `;
    this.el.style.display = 'flex';
    // Unlock pointer so user can scroll/click
    document.exitPointerLock();
  }

  close() {
    this.el.style.display = 'none';
    this._currentRoom = null;
  }

  _buildSkills(color) {
    return skills.map(cat => `
      <div class="skill-category">
        <div class="skill-cat-title" style="color: ${cat.color}">> ${cat.category}</div>
        <div class="skill-items">
          ${cat.items.map(s => `<span class="skill-chip" style="border-color: ${cat.color}44; color: ${cat.color}">${s}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }

  _buildProjects(color) {
    return `<div class="projects-grid">` + projects.map(p => `
      <div class="project-card" style="border-color: ${color}55">
        <div class="project-name" style="color: ${color}">${p.name}</div>
        <div class="project-meta">${p.client} — ${p.year} — ${p.role}</div>
        <div class="project-desc">${p.description}</div>
        <div class="project-stack">${p.stack.map(s => `<span class="stack-tag">${s}</span>`).join('')}</div>
        <div class="project-tags">${p.tags.map(t => `<span class="proj-tag" style="color:${color}"># ${t}</span>`).join(' ')}</div>
        ${p.url ? `<a href="${p.url}" target="_blank" class="project-link" style="color:${color}">→ VOIR LE PROJET</a>` : ''}
      </div>
    `).join('') + `</div>`;
  }

  _buildPassions(color) {
    return `<div class="passions-grid">` + passions.map(p => `
      <div class="passion-card" style="border-color: ${color}55">
        <div class="passion-icon">${p.icon}</div>
        <div class="passion-name" style="color: ${color}">${p.name}</div>
        <div class="passion-desc">${p.description}</div>
        <ul class="passion-details">
          ${p.details.map(d => `<li>> ${d}</li>`).join('')}
        </ul>
      </div>
    `).join('') + `</div>`;
  }
}
