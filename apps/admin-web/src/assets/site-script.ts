export const siteScript = `
(() => {
  const key = 'latex-renderer-theme';
  const allowed = new Set(['system', 'light', 'dark']);
  const stored = localStorage.getItem(key);
  const initial = stored && allowed.has(stored) ? stored : 'system';

  const apply = (theme) => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = theme;
  };

  const label = (theme) => theme === 'light' ? 'ライト' : theme === 'dark' ? 'ダーク' : 'システム';
  const syncButtons = (theme) => {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = '表示: ' + label(theme);
      button.setAttribute('aria-label', '表示テーマを変更。現在は' + label(theme));
    });
  };

  apply(initial);
  document.addEventListener('DOMContentLoaded', () => {
    let current = document.documentElement.dataset.themePreference || 'system';
    syncButtons(current);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        current = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
        localStorage.setItem(key, current);
        apply(current);
        syncButtons(current);
      });
    });

    document.querySelectorAll('.docs-content pre').forEach((pre) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = 'コピー';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
        button.textContent = 'コピー済み';
        window.setTimeout(() => { button.textContent = 'コピー'; }, 1500);
      });
      pre.append(button);
    });

    const search = document.querySelector('#docs-search');
    const results = document.querySelector('#docs-search-results');
    if (search && results) {
      let indexPromise;
      const loadIndex = () => indexPromise ||= fetch('/assets/docs-search.json').then((response) => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      });
      search.addEventListener('input', async () => {
        const query = search.value.normalize('NFKC').trim().toLocaleLowerCase('ja');
        results.replaceChildren();
        if (query.length < 2) return;
        try {
          const index = await loadIndex();
          const matches = index.filter((item) =>
            [item.title, item.description, item.category, item.text, ...item.headings.map((heading) => heading.text)]
              .join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(query)
          ).slice(0, 8);
          const list = document.createElement('ul');
          for (const item of matches) {
            const entry = document.createElement('li');
            const link = document.createElement('a');
            link.href = item.url;
            link.textContent = item.title + ' — ' + item.description;
            entry.append(link);
            list.append(entry);
          }
          if (matches.length === 0) results.textContent = '一致するページはありません。';
          else results.append(list);
        } catch {
          results.textContent = '検索索引を読み込めませんでした。';
        }
      });
    }
  });
})();
`;
