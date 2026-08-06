// Helpers

// Safe fallback for ffIsHoldModalOpen to prevent runtime crashes
window.ffIsHoldModalOpen = window.ffIsHoldModalOpen || (() => false);

/** Same idea as app.js ffSafeParseJSON - never throws on corrupt localStorage. */
function ffSafeParseJSON(str, fallback) {
  try {
    if (str == null || str === "") return fallback;
    if (typeof str !== "string") return fallback;
    const parsed = JSON.parse(str);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

const ls=(k,v)=>v===undefined?ffSafeParseJSON(localStorage.getItem(k),null):localStorage.setItem(k,JSON.stringify(v));

const $=s=>document.querySelector(s); const $$=s=>Array.from(document.querySelectorAll(s));

const btn=(t,c)=>{const b=document.createElement("button"); b.textContent=t; b.className=c; return b;};

const stamp=()=>new Date().toLocaleString();

const escapeHtml=s=>(s||"").replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));

function toDataURL(file){return new Promise(res=>{const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file);});}

function formatHistoryDate(date) {
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit'
  });
}

function formatHistoryTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}


