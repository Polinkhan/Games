# games.polinkhan.com — landing page

Static site: `index.html`, `styles.css`, `main.js`, `favicon.svg`, `assets/`.
No build step. The original banners (`Tash.jpeg`, `3D-arena.jpeg`) are not used by the page;
`assets/` holds web-sized WebP/JPEG versions and the 1200×630 share image.

Preview locally:

    python3 -m http.server 8000   # then open http://localhost:8000

Game links on the page: `/tash/` and `/arena/`. Example Caddy config:

    games.polinkhan.com {
        handle_path /tash/* {
            reverse_proxy localhost:3001   # Tash server (needs base-path changes first)
        }
        handle_path /arena/* {
            reverse_proxy localhost:3000   # Cyber-Arena server
        }
        handle {
            root * /var/www/games-landing
            file_server
        }
    }

    play.polinkhan.com {
        redir https://games.polinkhan.com{uri} permanent
    }
