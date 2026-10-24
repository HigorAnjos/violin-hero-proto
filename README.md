# violin-hero-proto

Protótipo do Violin Hero — um jogo estilo Guitar Hero para violino.

## Status

🚧 Em desenvolvimento (protótipo inicial)

Prévia: https://higoranjos.github.io/violin-hero-proto/

## Rodando localmente

Requer Node 22.

```sh
npm ci
npm run dev      # HTTPS com certificado autoassinado, exposto na rede local
npm test         # Vitest
npm run build    # tsc + build de produção em dist/
npm run preview  # serve o dist/ com o mesmo base do GitHub Pages
```

O navegador só libera o microfone em contexto seguro, por isso o dev server roda em HTTPS.
Para testar no celular, abra `https://<ip-da-máquina>:5173/` e aceite o certificado.

Push em `main` ou `fase-*/**` publica a prévia no GitHub Pages (`.github/workflows/preview.yml`).

## Licença

MIT
