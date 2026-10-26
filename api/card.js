const W = 500;

const THEMES = {
  dark: { card: '#111214', panel: '#1e1f22', text: '#f2f3f5', sub: '#b5bac1', muted: '#80848e' },
  light: { card: '#ffffff', panel: '#f2f3f5', text: '#060607', sub: '#4e5058', muted: '#6d6f78' },
};
const STATUS = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', offline: '#80848e' };
const TYPE_LABEL = { 0: 'OYNUYOR', 1: 'YAYINDA', 2: 'DİNLİYOR', 3: 'İZLİYOR', 5: 'YARIŞIYOR' };

const esc = (s) =>
  String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const trunc = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

function wrap(text, max, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = trunc(lines[maxLines - 1] + '…', max);
  }
  return lines;
}

async function getJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function toDataUri(url, maxBytes = Infinity) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || 'image/png').split(';')[0];
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function pickImage(animUrl, staticUrl, maxBytes) {
  if (animUrl) {
    const d = await toDataUri(animUrl, maxBytes);
    if (d) return d;
  }
  return toDataUri(staticUrl);
}

function activityImageUrl(a) {
  const img = a?.assets?.large_image;
  if (!img) return null;
  if (img.startsWith('mp:external/')) return `https://media.discordapp.net/external/${img.slice('mp:external/'.length)}`;
  if (img.startsWith('mp:')) return null;
  if (a.application_id) return `https://cdn.discordapp.com/app-assets/${a.application_id}/${img}.png`;
  return null;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const id = String(q.id || '').replace(/\D/g, '');
  if (!id) {
    res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8').send('id parametresi gerekli: /api/card?id=KULLANICI_ID');
    return;
  }

  const t = THEMES[q.theme === 'light' ? 'light' : 'dark'];
  const idleMsg = q.idle || 'Şu an sessizim 🌙';

  const [lan, prof] = await Promise.all([
    getJson(`https://api.lanyard.rest/v1/users/${id}`),
    getJson(`https://dcdn.dstn.to/profile/${id}`),
  ]);

  const live = lan && lan.success ? lan.data : null;
  const user = { ...(live?.discord_user || {}), ...(prof?.user || {}) };
  const profile = prof?.user_profile || {};

  const username = user.username || id;
  const display = user.global_name || username;
  const status = STATUS[live?.discord_status] ? live.discord_status : 'offline';
  const pronouns = profile.pronouns || '';
  const bio = q.bio || profile.bio || '';

  const hexOk = (v) => /^[0-9a-f]{6}$/i.test(v || '');
  let bannerColor = '#5865f2';
  if (hexOk(q.accent)) bannerColor = '#' + q.accent;
  else if (user.banner_color) bannerColor = user.banner_color;
  else if (typeof user.accent_color === 'number') bannerColor = '#' + user.accent_color.toString(16).padStart(6, '0');

  const avatarStatic = user.avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=128`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
  const avatarAnim =
    user.avatar && user.avatar.startsWith('a_') && q.static !== 'true'
      ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.gif?size=128`
      : null;
  const bannerStatic = user.banner ? `https://cdn.discordapp.com/banners/${id}/${user.banner}.png?size=600` : null;
  const bannerAnim =
    user.banner && user.banner.startsWith('a_') && q.static !== 'true'
      ? `https://cdn.discordapp.com/banners/${id}/${user.banner}.gif?size=480`
      : null;
  const decoAsset = prof?.user?.avatar_decoration_data?.asset || live?.discord_user?.avatar_decoration_data?.asset;
  const decoBase = decoAsset && q.hideDecoration !== 'true'
    ? `https://cdn.discordapp.com/avatar-decoration-presets/${decoAsset}.png?size=240`
    : null;
  const decoAnim = decoBase && q.static !== 'true' ? decoBase + '&passthrough=true' : null;

  if (q.debug === 'true') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(
      JSON.stringify(
        {
          lanyard: !!live,
          profile: !!prof,
          decoration: decoAsset || null,
          avatarAnimated: !!avatarAnim,
          bannerAnimated: !!bannerAnim,
          profileEffect: prof?.user_profile?.profile_effect || prof?.profile_effect || null,
        },
        null,
        2
      )
    );
    return;
  }

  const badgeList = q.hideBadges === 'true' ? [] : (prof?.badges || []).filter((b) => b.icon).slice(0, 8);

  const acts = live?.activities || [];
  const spotify = live?.listening_to_spotify ? live.spotify : null;
  const other = acts.find((a) => a.type !== 4 && a.id !== 'spotify:1' && a.name !== 'Spotify');
  const custom = acts.find((a) => a.type === 4);

  let actLabel = 'DURUM';
  let actLines = [];
  let actImgUrl = null;

  if (spotify) {
    actLabel = "SPOTIFY'DA DİNLİYOR";
    actLines = [spotify.song, String(spotify.artist || '').replace(/;\s*/g, ', '), spotify.album];
    actImgUrl = spotify.album_art_url;
  } else if (other) {
    actLabel = TYPE_LABEL[other.type] || 'AKTİVİTE';
    actLines = [other.name, other.details, other.state];
    actImgUrl = activityImageUrl(other);
  } else {
    const emoji = custom?.emoji && !custom.emoji.id ? custom.emoji.name + ' ' : '';
    actLines = [custom?.state ? emoji + custom.state : idleMsg];
  }
  actLines = actLines.filter(Boolean).slice(0, 3);

  const [avatarData, bannerData, actImgData, decoData, ...badgeData] = await Promise.all([
    pickImage(avatarAnim, avatarStatic, 900_000),
    pickImage(bannerAnim, bannerStatic, 2_200_000),
    toDataUri(actImgUrl),
    pickImage(decoAnim, decoBase, 700_000),
    ...badgeList.map((b) => toDataUri(`https://cdn.discordapp.com/badge-icons/${b.icon}.png`)),
  ]);

  const BANNER_H = 110;

  const base = /^#[0-9a-f]{6}$/i.test(bannerColor) ? bannerColor : '#5865f2';
  const mix = (c, a, target) => {
    const n = parseInt(c.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * a));
    return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const light = mix(base, 0.55, 255);
  const dark = mix(base, 0.45, 0);
  let y = 218;
  let body = '';

  let badgesSvg = '';
  const okBadges = badgeData.filter(Boolean);
  if (okBadges.length) {
    const pillW = okBadges.length * 28 + 8;
    const px = W - 16 - pillW;
    badgesSvg += `<rect class="f" x="${px}" y="122" width="${pillW}" height="30" rx="15" fill="${t.panel}"/>`;
    okBadges.forEach((d, i) => {
      badgesSvg += `<image x="${px + 8 + i * 28}" y="126" width="22" height="22" xlink:href="${d}"/>`;
    });
  }

  if (bio && q.hideBio !== 'true') {
    const lines = wrap(bio, 58, 4);
    const h = 40 + lines.length * 18;
    body += `<g class="f"><rect x="16" y="${y}" width="${W - 32}" height="${h}" rx="12" fill="${t.panel}"/>`;
    body += `<text x="32" y="${y + 24}" font-size="11" font-weight="700" letter-spacing="1" fill="${t.muted}">HAKKIMDA</text>`;
    lines.forEach((l, i) => {
      body += `<text x="32" y="${y + 46 + i * 18}" font-size="13" fill="${t.sub}">${esc(l)}</text>`;
    });
    body += `</g>`;
    y += h + 12;
  }

  {
    const hasImg = !!actImgData;
    const h = hasImg ? 104 : actLines.length > 1 ? 40 + actLines.length * 20 : 64;
    body += `<g class="f"><rect x="16" y="${y}" width="${W - 32}" height="${h}" rx="12" fill="${t.panel}"/>`;
    body += `<text x="32" y="${y + 24}" font-size="11" font-weight="700" letter-spacing="1" fill="${spotify ? '#1db954' : t.muted}">${esc(actLabel)}</text>`;
    const tx = hasImg ? 98 : 32;
    if (hasImg) {
      body += `<clipPath id="ai"><rect x="32" y="${y + 36}" width="56" height="56" rx="8"/></clipPath>`;
      body += `<image x="32" y="${y + 36}" width="56" height="56" clip-path="url(#ai)" preserveAspectRatio="xMidYMid slice" xlink:href="${actImgData}"/>`;
    }
    const startY = hasImg ? y + 52 : y + 48;
    actLines.forEach((l, i) => {
      const bold = i === 0;
      body += `<text x="${tx}" y="${startY + i * 18}" font-size="${bold ? 14 : 12}" font-weight="${bold ? 700 : 400}" fill="${bold ? t.text : t.sub}">${esc(trunc(l, hasImg ? 46 : 62))}</text>`;
    });
    body += `</g>`;
    y += h + 16;
  }

  const H = y;

  const showFrame = q.frame !== 'false';
  const frameDef = showFrame
    ? `<linearGradient id="fr" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}"><stop offset="0" stop-color="${base}"/><stop offset=".35" stop-color="${light}"/><stop offset=".65" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/><animateTransform attributeName="gradientTransform" type="rotate" from="0 ${W / 2} ${H / 2}" to="360 ${W / 2} ${H / 2}" dur="6s" repeatCount="indefinite"/></linearGradient>`
    : '';
  const frame = showFrame
    ? `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18.5" fill="none" stroke="url(#fr)" stroke-width="3"/>`
    : '';

  let sparkles = '';
  if (q.effect !== 'none') {
    let seed = Number(BigInt(id) % 2147483647n) || 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 16; i++) {
      const x = (rnd() * (W - 20) + 10).toFixed(1);
      const yy = rnd() * (H - 20) + 10;
      const r = (0.8 + rnd() * 1.8).toFixed(1);
      const dur = (3 + rnd() * 4).toFixed(1);
      const begin = (rnd() * 4).toFixed(1);
      const drift = 8 + rnd() * 14;
      sparkles += `<circle cx="${x}" cy="${yy.toFixed(1)}" r="${r}" fill="${i % 3 ? '#ffffff' : light}" opacity="0"><animate attributeName="opacity" values="0;0.8;0" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="cy" values="${yy.toFixed(1)};${(yy - drift).toFixed(1)}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif">
<title>${esc(display)} - Discord</title>
<style>.f{animation:f .8s ease both}@keyframes f{from{opacity:0}to{opacity:1}}</style>
<defs>
<clipPath id="card"><rect width="${W}" height="${H}" rx="20"/></clipPath>
<clipPath id="av"><circle cx="64" cy="112" r="42"/></clipPath>
${frameDef}
</defs>
<g clip-path="url(#card)">
<rect width="${W}" height="${H}" fill="${t.card}"/>
<rect width="${W}" height="${BANNER_H}" fill="${esc(bannerColor)}"/>
${bannerData ? `<image width="${W}" height="${BANNER_H}" preserveAspectRatio="xMidYMid slice" xlink:href="${bannerData}"/>` : ''}
<circle cx="64" cy="112" r="49" fill="${t.card}"/>
${avatarData ? `<image x="22" y="70" width="84" height="84" clip-path="url(#av)" xlink:href="${avatarData}"/>` : `<circle cx="64" cy="112" r="42" fill="${t.panel}"/>`}
${decoData ? `<image x="14" y="62" width="100" height="100" xlink:href="${decoData}"/>` : ''}
<circle cx="98" cy="146" r="13" fill="${t.card}"/>
<circle cx="98" cy="146" r="9" fill="${STATUS[status]}"/>
${badgesSvg}
<text x="24" y="188" font-size="22" font-weight="700" fill="${t.text}">${esc(trunc(display, 28))}</text>
<text x="24" y="208" font-size="13" fill="${t.sub}">${esc(username)}${pronouns ? ` · ${esc(pronouns)}` : ''}</text>
${body}
${sparkles}
</g>
${frame}
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.status(200).send(svg);
};
