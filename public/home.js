// Fades/slides elements in as they scroll into view. Progressive
// enhancement only — if IntersectionObserver isn't supported, everything
// just stays visible via the CSS fallback below.
document.addEventListener('DOMContentLoaded', () => {
  const targets = document.querySelectorAll('.reveal');

  if (!('IntersectionObserver' in window)) {
    targets.forEach((el) => el.classList.add('in-view'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );

  targets.forEach((el) => observer.observe(el));
});

// Auto-scrolling carousels (food filmstrip + reviews), driven by
// requestAnimationFrame instead of a CSS animation. This is
// self-correcting every frame — unlike a CSS keyframe animation it
// can't silently pause or stop after a while on any browser — and the
// speed is a plain px/second number that's easy to tune.
function autoScrollCarousel(track, speedPxPerSec, direction) {
  if (!track) return;

  let halfWidth = track.scrollWidth / 2;
  let x = direction === 'reverse' ? -halfWidth : 0;
  let lastTime = null;

  function frame(time) {
    if (lastTime === null) lastTime = time;
    // Clamp the per-frame delta so a backgrounded tab resuming (or any
    // long stall) can't cause a huge jump — it just catches up smoothly.
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    if (direction === 'reverse') {
      x += speedPxPerSec * dt;
      if (x >= 0) x -= halfWidth;
    } else {
      x -= speedPxPerSec * dt;
      if (x <= -halfWidth) x += halfWidth;
    }

    track.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    halfWidth = track.scrollWidth / 2;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  autoScrollCarousel(document.getElementById('carouselTrack'), 75, 'forward');
  autoScrollCarousel(document.getElementById('reviewsTrack'), 52, 'reverse');
});
