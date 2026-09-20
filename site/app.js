const root = document.documentElement;
const menuButton = document.querySelector('.menu-button');
const scrim = document.querySelector('.scrim');
const navLinks = [...document.querySelectorAll('.sidebar nav a')];
const searchable = [...document.querySelectorAll('.searchable')];
const search = document.querySelector('#docs-search');
const status = document.querySelector('.search-status');

function closeMenu() { root.classList.remove('menu-open'); menuButton.setAttribute('aria-expanded', 'false'); }
menuButton.addEventListener('click', () => { const open = root.classList.toggle('menu-open'); menuButton.setAttribute('aria-expanded', String(open)); });
scrim.addEventListener('click', closeMenu);
navLinks.forEach((link) => link.addEventListener('click', closeMenu));

document.querySelectorAll('pre').forEach((block) => {
  const button = document.createElement('button');
  button.className = 'copy-button'; button.type = 'button'; button.textContent = 'Copy';
  button.addEventListener('click', async () => { await navigator.clipboard.writeText(block.querySelector('code').innerText); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1400); });
  block.append(button);
});

search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase(); let shown = 0;
  searchable.forEach((section) => { const match = !query || `${section.dataset.search || ''} ${section.innerText}`.toLowerCase().includes(query); section.classList.toggle('hidden', !match); if (match) shown += 1; });
  status.textContent = query ? `${shown} section${shown === 1 ? '' : 's'} found` : '';
});

const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
}, { rootMargin: '-20% 0px -65% 0px', threshold: [0, .25, .5] });
searchable.forEach((section) => observer.observe(section));
