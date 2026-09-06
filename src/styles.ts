const CSS = `
.deepTavernView{display:grid;grid-template-columns:minmax(220px,31%) minmax(0,1fr);min-height:0;height:100%;background:radial-gradient(circle at 20% 0,#2f3852,#111521 55%);color:#e9edf5;font-family:Georgia,serif}
.deepTavernPortrait{position:sticky;top:0;align-self:start;min-height:100%;padding:24px 18px;background:linear-gradient(180deg,#1e263a,#121722);border-right:1px solid #56617b;text-align:center}
.deepTavernPortraitImage{display:block;width:100%;padding:0;border:0;background:#0c1019;aspect-ratio:3/4;overflow:hidden;cursor:pointer}.deepTavernPortraitImage img{width:100%;height:100%;object-fit:contain}.deepTavernPortraitImage span{display:grid;height:100%;place-items:center;color:#9eaac4}.deepTavernEmotion{margin-top:12px;text-transform:capitalize;color:#ffd78d}
.deepTavernPortraitToggle{display:none}.deepTavernPicker{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin-top:12px;max-height:220px;overflow:auto}.deepTavernPicker button{border:1px solid #4f5d7b;background:#252d40;color:#e9edf5;border-radius:3px;padding:5px;text-transform:capitalize}
.deepTavernTranscript{max-width:900px;width:100%;margin:0 auto;padding:36px 28px 180px;overflow-wrap:anywhere}.deepTavernRecord{padding:14px 17px;border:1px solid #59627a;border-radius:6px;background:rgba(25,31,45,.86);box-shadow:0 8px 24px #0003;margin:0 0 16px;white-space:pre-wrap;line-height:1.55}.deepTavernRecord header{font-family:system-ui,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#aeb9d2;margin-bottom:8px}.deepTavernRecord time{float:right;font-weight:400;letter-spacing:0;color:#8390aa}.deepTavern-user{margin-left:12%;background:#273b50;border-color:#55789a}.deepTavern-assistant{margin-right:6%;border-left:4px solid #d89a57}.deepTavern-tool,.deepTavern-reasoning,.deepTavern-status{font-family:ui-monospace,monospace;font-size:13px;color:#c4cada;background:#171c29;border-style:dashed}
.deepTavernSettings{max-width:920px;padding:10px 20px;color:var(--dsw-alias-label-primary,#1b2432)}.deepTavernSettings code{overflow-wrap:anywhere}.deepTavernSpriteGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:18px}.deepTavernSpriteCard{display:grid;gap:6px;padding:10px;border:1px solid #c6cfde;border-radius:6px;text-transform:capitalize}.deepTavernSpriteCard span{font-size:12px;color:#65718a}.deepTavernSpritePreview{display:flex;align-items:center;gap:6px}.deepTavernSpritePreview img{width:36px;height:36px;object-fit:cover;border-radius:3px}
@media(max-width:760px){.deepTavernView{display:block}.deepTavernPortrait{position:relative;min-height:0;border-right:0;border-bottom:1px solid #56617b;padding:10px}.deepTavernPortrait[data-visible]{display:grid;grid-template-columns:90px 1fr;gap:10px;text-align:left}.deepTavernPortraitImage{width:90px;grid-row:span 2}.deepTavernPortraitToggle{display:block;position:absolute;right:10px;top:10px}.deepTavernPicker{grid-column:1/-1}.deepTavernTranscript{padding:20px 14px 140px}.deepTavern-user,.deepTavern-assistant{margin-left:0;margin-right:0}}
`

export function installStyles(): void {
  if (document.querySelector('style[data-deep-tavern]') !== null) return
  const style = document.createElement('style')
  style.dataset.deepTavern = ''
  style.textContent = CSS
  document.head.appendChild(style)
}
