// GET /f/embed.js — the auto-resize script the embed snippet loads (0158).
// Finds every <iframe data-or-form> on the host page and sets its height
// from the `or-form:height` messages the embedded form posts. Plain JS,
// no dependencies, safe to include more than once.

import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

const SCRIPT = `(function(){
  if (window.__orFormEmbed) return; window.__orFormEmbed = true;
  function frames(){ return Array.prototype.slice.call(document.querySelectorAll('iframe[data-or-form]')); }
  window.addEventListener('message', function(e){
    var d = e.data; if (!d || d.type !== 'or-form:height' || typeof d.height !== 'number') return;
    frames().forEach(function(f){
      if (f.contentWindow === e.source) { f.style.height = Math.max(240, d.height + 8) + 'px'; }
    });
  });
  function init(){ frames().forEach(function(f){ if (!f.style.height) f.style.height = '480px'; f.setAttribute('scrolling','no'); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`;

export function GET() {
	return new NextResponse(SCRIPT, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=3600, s-maxage=86400',
			'Access-Control-Allow-Origin': '*',
		},
	});
}
