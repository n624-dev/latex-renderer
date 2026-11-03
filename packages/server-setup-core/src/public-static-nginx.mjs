// Only the existing public-static generator's routes are exposed here. Every
// authenticated route and every source/artifact remains behind its API.
export const publicHealthNginx = `
  location @latex_renderer_legacy_api_health { proxy_pass http://127.0.0.1:3105; }
  location = /api/v1/health {
    proxy_pass http://unix:/run/latex-renderer-status/status.sock;
    proxy_intercept_errors on;
    error_page 502 504 = @latex_renderer_legacy_api_health;
  }
  location = /health {
    proxy_pass http://unix:/run/latex-renderer-status/status.sock;
    proxy_intercept_errors on;
    error_page 502 504 = @latex_renderer_web;
  }
  location = /health/rendering { proxy_pass http://unix:/run/latex-renderer-status/status.sock; }
  location = /health/status { proxy_pass http://unix:/run/latex-renderer-status/status.sock; }
`;
export const publicStaticNginx = `
  location @latex_renderer_web { proxy_pass http://127.0.0.1:3101; }
  location = / {
    root /opt/latex-renderer/current/apps/public-web/dist;
    try_files /index.html @latex_renderer_web;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header Cache-Control "public, max-age=0, must-revalidate, no-transform" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
  }
  location ~ ^/(?:docs(?:/|$)|downloads(?:/|$)|assets/(?:styles\\.css|site\\.js|login\\.js|docs-search\\.json)$|openapi/(?:gateway|renderer)\\.openapi\\.yaml$) {
    root /opt/latex-renderer/current/apps/public-web/dist;
    try_files $uri $uri/index.html @latex_renderer_web;
    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header Cache-Control "public, max-age=0, must-revalidate, no-transform" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
  }
`;
