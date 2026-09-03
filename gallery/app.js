// Gallery data. Swap `src` for a real product photo URL (or a local
// /images/ path once real product images exist) to replace a placeholder —
// everything else (grid, srcset, lightbox) works the same either way.
const GALLERY_ITEMS = [
  {
    src: 'https://picsum.photos/seed/shadow-ledger/1600/1600',
    alt: 'Placeholder preview image for the Shadow Ledger',
    caption: 'Shadow Ledger',
    desc: 'A written practice for the Victim stage: trace the pattern back to its root.',
  },
  {
    src: 'https://picsum.photos/seed/four-stages-os/1600/1600',
    alt: 'Placeholder preview image for the Four Stages OS Notion template',
    caption: 'Four Stages OS',
    desc: 'A Notion template for the Creator stage: run life through a system instead of sheer will.',
  },
  {
    src: 'https://picsum.photos/seed/the-cave/1600/1600',
    alt: 'Placeholder preview image for The Cave series',
    caption: 'The Cave',
    desc: 'A series for the Witness stage: turn observation into integration.',
  },
  {
    src: 'https://picsum.photos/seed/quantum-life-blueprint/1600/1600',
    alt: 'Placeholder preview image for the Quantum Life Blueprint',
    caption: 'Quantum Life Blueprint',
    desc: 'The book for the Unity stage: the complete framework, written down.',
  },
];

const WIDTHS = [400, 800, 1200];

function netlifyImageUrl(src, width) {
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    fit: 'cover',
    fm: 'avif',
    q: '80',
  });
  return `/.netlify/images?${params.toString()}`;
}

function buildSrcset(src) {
  return WIDTHS.map((w) => `${netlifyImageUrl(src, w)} ${w}w`).join(', ');
}

const grid = document.getElementById('gallery-grid');

GALLERY_ITEMS.forEach((item, index) => {
  const cell = document.createElement('div');
  cell.className = 'gallery-item';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', `View larger image: ${item.caption}`);
  button.addEventListener('click', () => openLightbox(index));

  const img = document.createElement('img');
  img.src = netlifyImageUrl(item.src, 800);
  img.srcset = buildSrcset(item.src);
  img.sizes = '(min-width: 900px) 25vw, (min-width: 600px) 33vw, 100vw';
  img.alt = item.alt;
  img.width = 800;
  img.height = 800;
  if (index === 0) {
    img.loading = 'eager';
    img.fetchPriority = 'high';
  } else {
    img.loading = 'lazy';
  }
  button.appendChild(img);
  cell.appendChild(button);

  const caption = document.createElement('div');
  caption.className = 'gallery-caption';

  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = item.caption;
  caption.appendChild(name);

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = item.desc;
  caption.appendChild(desc);

  cell.appendChild(caption);
  grid.appendChild(cell);
});

// Lightbox

const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxName = document.getElementById('lightbox-name');
const lightboxDesc = document.getElementById('lightbox-desc');
const prevBtn = document.getElementById('lightbox-prev');
const nextBtn = document.getElementById('lightbox-next');
const closeBtn = document.getElementById('lightbox-close');

let currentIndex = 0;

function renderLightbox() {
  const item = GALLERY_ITEMS[currentIndex];
  lightboxImg.src = netlifyImageUrl(item.src, 1200);
  lightboxImg.alt = item.alt;
  lightboxName.textContent = item.caption;
  lightboxDesc.textContent = item.desc;
}

function openLightbox(index) {
  currentIndex = index;
  renderLightbox();
  lightbox.showModal();
}

function showPrev() {
  currentIndex = (currentIndex - 1 + GALLERY_ITEMS.length) % GALLERY_ITEMS.length;
  renderLightbox();
}

function showNext() {
  currentIndex = (currentIndex + 1) % GALLERY_ITEMS.length;
  renderLightbox();
}

prevBtn.addEventListener('click', showPrev);
nextBtn.addEventListener('click', showNext);
closeBtn.addEventListener('click', () => lightbox.close());

lightbox.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    showPrev();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    showNext();
  }
  // Escape-to-close is handled natively by <dialog>.
});
