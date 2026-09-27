(() => {
  let theme='purple';
  try{const saved=JSON.parse(localStorage.getItem('uust.campus.v1.theme'));if(['green','purple'].includes(saved))theme=saved;}catch{}
  function apply(value){
    theme=value==='green'?'green':'purple';document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('uust.campus.v1.theme',JSON.stringify(theme));}catch{}
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='purple'?'#5b21b6':'#173b32');
    document.querySelectorAll('[data-theme-choice]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.themeChoice===theme)));
    try{window.CampusAndroid?.setColorTheme(theme);}catch{}
    document.querySelector('link[rel="icon"]')?.setAttribute('href',theme==='purple'?'assets/uust-logo.png':'assets/uust-logo-green.png');
  }
  document.addEventListener('click',e=>{const el=e.target.closest('[data-theme-choice]');if(el)apply(el.dataset.themeChoice);});
  window.campusTheme={get:()=>theme,apply};apply(theme);
})();
