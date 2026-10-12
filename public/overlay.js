(() => {
  const sponsorLogo = new Image(); sponsorLogo.src = '/the-smokery-logo.png';

  function drawCover(ctx, video, width, height) {
    const sourceRatio = video.videoWidth / video.videoHeight || 16 / 9; const targetRatio = width / height;
    let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
    if (sourceRatio > targetRatio) { sw = video.videoHeight * targetRatio; sx = (video.videoWidth - sw) / 2; }
    else { sh = video.videoWidth / targetRatio; sy = (video.videoHeight - sh) / 2; }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  }
  function roundedRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); }
  function drawScoreOverlay(ctx, width, height, s) {
    const scale = width / 1280; const pad = 18 * scale; const previousGames = s.gameResults.slice().reverse(); const boxW = Math.min(490 * scale, width - pad * 2); const boxH = (140 + (previousGames.length ? 28 + previousGames.length * 25 : 0)) * scale; const x = width - boxW - pad; const y = pad + 8 * scale;
    ctx.fillStyle = 'rgba(5, 10, 17, .86)'; roundedRect(ctx, x, y, boxW, boxH, 14 * scale); ctx.fill();
    ctx.strokeStyle = 'rgba(100, 241, 210, .35)'; ctx.lineWidth = 2 * scale; roundedRect(ctx, x, y, boxW, boxH, 14 * scale); ctx.stroke();
    ctx.font = `800 ${13 * scale}px system-ui`; ctx.fillStyle = '#d3a94f'; ctx.fillText('SHUTTLECAST  •  LIVE', x + 18 * scale, y + 25 * scale);
    ctx.fillStyle = s.teamColorA; ctx.beginPath(); ctx.arc(x + 22 * scale, y + 53 * scale, 5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = s.teamColorB; ctx.beginPath(); ctx.arc(x + 22 * scale, y + 87 * scale, 5 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.font = `700 ${18 * scale}px system-ui`; ctx.fillStyle = '#f5f8ff'; ctx.fillText(s.sideA, x + 36 * scale, y + 57 * scale); ctx.fillText(s.sideB, x + 36 * scale, y + 91 * scale);
    ctx.font = `800 ${31 * scale}px monospace`; ctx.fillStyle = '#fff'; ctx.fillText(String(s.scoreA).padStart(2, '0'), x + boxW - 118 * scale, y + 61 * scale); ctx.fillStyle = '#fff'; ctx.fillText(String(s.scoreB).padStart(2, '0'), x + boxW - 118 * scale, y + 95 * scale);
    const historyTop = y + 123 * scale; ctx.font = `800 ${10 * scale}px monospace`; ctx.fillStyle = 'rgba(255,255,255,.78)'; ctx.fillText(`GAME ${s.game} / ${s.matchGames}  •  ${s.winsA}-${s.winsB}`, x + 18 * scale, historyTop);
    previousGames.forEach((result, index) => { const rowY = historyTop + (20 + index * 25) * scale; ctx.font = `700 ${13 * scale}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.62)'; ctx.fillText(`GAME ${result.game}`, x + 18 * scale, rowY); ctx.font = `800 ${17 * scale}px monospace`; ctx.fillStyle = result.winner === 'A' ? '#ff7f67' : '#fff'; ctx.fillText(String(result.scoreA).padStart(2, '0'), x + boxW - 118 * scale, rowY); ctx.fillStyle = result.winner === 'B' ? '#ff7f67' : '#fff'; ctx.fillText(String(result.scoreB).padStart(2, '0'), x + boxW - 69 * scale, rowY); });
  }
  function drawSponsorOverlay(ctx, width, height) {
    if (!sponsorLogo.complete || !sponsorLogo.naturalWidth) return;
    const scale = width / 1280; const panelW = 125 * scale; const panelH = 117.5 * scale; const x = width - panelW - 18 * scale; const y = height - panelH - 18 * scale;
    ctx.fillStyle = 'rgba(0, 0, 0, .5)'; roundedRect(ctx, x, y, panelW, panelH, 6 * scale); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = `600 ${6.5 * scale}px system-ui`; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText('sponsored by', x + panelW / 2, y + 11 * scale);
    const maxW = panelW - 10 * scale; const maxH = panelH - 17 * scale; const ratio = sponsorLogo.naturalWidth / sponsorLogo.naturalHeight; const logoW = Math.min(maxW, maxH * ratio); const logoH = logoW / ratio;
    ctx.drawImage(sponsorLogo, x + (panelW - logoW) / 2, y + 14.5 * scale, logoW, logoH); ctx.textAlign = 'start';
  }
  function drawFrame(ctx, video, width, height, s) {
    if (video && video.videoWidth) drawCover(ctx, video, width, height); else { ctx.fillStyle = '#050911'; ctx.fillRect(0, 0, width, height); }
    if (s) drawScoreOverlay(ctx, width, height, s);
    drawSponsorOverlay(ctx, width, height);
  }
  window.ShuttleOverlay = { drawFrame, drawCover, drawScoreOverlay, drawSponsorOverlay };
})();
