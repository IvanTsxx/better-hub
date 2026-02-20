import type { ThemeDefinition } from "./themes/types";

/**
 * Generate an inline script that applies the saved color theme before first paint.
 * Sets both CSS variables and the dark/light class based on the theme's mode.
 */
export function generateThemeScript(themes: ThemeDefinition[]): string {
  // Serialize: id → { mode, colors }
  const data: Record<string, { mode: string; colors: Record<string, string> }> = {};
  for (const t of themes) {
    data[t.id] = { mode: t.mode, colors: { ...t.colors } };
  }

  return `(function(){try{var d=document.documentElement;var id=localStorage.getItem("color-theme")||"midnight";var themes=${JSON.stringify(data)};var t=themes[id];if(!t)t=themes["midnight"];if(!t)return;if(t.mode==="dark"){d.classList.add("dark");d.classList.remove("light");d.style.colorScheme="dark"}else{d.classList.remove("dark");d.classList.add("light");d.style.colorScheme="light"}localStorage.setItem("theme",t.mode);if(id!=="midnight"){for(var k in t.colors){d.style.setProperty(k,t.colors[k])}}var cp=localStorage.getItem("code-theme-prefs");if(cp){try{var p=JSON.parse(cp);if(p.bg)d.style.setProperty("--code-theme-bg",p.bg);if(p.font)d.style.setProperty("--code-font-override",p.font);if(p.fontSize)d.style.setProperty("--code-font-size",p.fontSize+"px")}catch(e2){}}}catch(e){}})()`;
}
