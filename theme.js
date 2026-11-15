/* the look (dark / light) is chosen per device; set before the first paint so the page never flashes the other one */
(function () { var t = 'dark'; try { t = localStorage.getItem('koga_theme') || 'dark'; } catch (e) {} if (t !== 'light') t = 'dark';
  document.documentElement.setAttribute('data-theme', t);
  var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'light' ? '#EDF0EA' : '#06070A'); })();
