# Déploiement sur Oracle Cloud (Always Free) + DuckDNS

Objectif : l'API tourne sur une VM gratuite en permanence, ton PC peut être éteint.
Le site routeur Cloudflare reste le point d'entrée public et pointe vers la VM.

```
Launcher / Admin  →  https://assetown-api-router-…freebuff.site/api  (Cloudflare)
                  →  https://<ton-sous-domaine>.duckdns.org        (Caddy, TLS)
                  →  conteneur api:4200                             (Oracle VM)
                  →  /data (SQLite + builds + skins)
```

Ce qui est fourni dans `deploy/` : `Dockerfile` (multi-arch, testé sur Node 24),
`docker-compose.yml` (API + Caddy), `Caddyfile` (HTTPS + IP réelle des joueurs),
`server.env.example` (configuration backend), `.env.example` (domaine).

---

## 1. Créer le compte Oracle Cloud

1. <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Choisis une **home region** proche de tes joueurs (ex. `France Central (Paris)`).
   ⚠️ Elle ne peut plus être changée ensuite, et les ressources Always Free
   doivent y être créées.
3. Une carte bancaire est demandée pour vérifier l'identité (aucun débit sur
   l'offre Always Free). Évite les adresses e-mail jetables : elles sont refusées.

## 2. Créer la VM

Console OCI → **Compute → Instances → Create instance** :

| Champ | Valeur |
| --- | --- |
| Name | `assetown-api` |
| Image | **Canonical Ubuntu 24.04** (aarch64) |
| Shape | **Ampere / VM.Standard.A1.Flex** |
| OCPU / RAM | **2 OCPU / 12 GB** (plafond Always Free depuis juin 2026) |
| Boot volume | 50 GB (le minimum est ~47 GB) |
| Networking | VCN par défaut, **public subnet**, **Assign public IPv4** |
| SSH keys | upload de ta clé publique `~/.ssh/id_ed25519.pub` |

> Si le shape Ampere est indisponible (« Out of capacity »), réessaie à une autre
> heure ou dans une autre availability domain. C'est la limite la plus courante.
>
> **Instance inactive** : Oracle peut récupérer une VM Always Free restée 7 jours
> sous 20 % de CPU/réseau. Une API avec de vrais joueurs dépasse largement ce
> seuil ; si tu la laisses sans trafic, relance-la de temps en temps.

Note l'**IP publique** de l'instance.

## 3. Ouvrir les ports (deux niveaux obligatoires)

**a) Security List OCI** — VCN → Security Lists → Default Security List →
Add Ingress Rules :

| Source | Protocol | Destination port |
| --- | --- | --- |
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

**b) Pare-feu de l'image Ubuntu** (les images OCI bloquent tout sauf SSH) :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Sous-domaine DuckDNS

1. <https://www.duckdns.org> → connexion (Google/GitHub) → crée un sous-domaine,
   par ex. `assetown-api`.
2. Renseigne l'IP publique de la VM et clique **update ip**, ou :

```bash
curl "https://www.duckdns.org/update?domains=assetown-api&token=TON_TOKEN&ip=IP_DE_LA_VM"
```

Le domaine `assetown-api.duckdns.org` doit répondre à `ping` sur l'IP de la VM.
Caddy obtiendra le certificat HTTPS automatiquement (DuckDNS est sur la liste
publique des suffixes, Let's Encrypt l'accepte).

## 5. Installer Docker sur la VM

```bash
ssh ubuntu@IP_DE_LA_VM
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit            # se reconnecter pour appliquer le groupe
docker run --rm hello-world
```

## 6. Envoyer le projet

Depuis **Git Bash sur ton PC**, à la racine du dépôt :

```bash
tar --exclude=node_modules --exclude=release --exclude=logs --exclude=.runtime \
    --exclude='apps/backend/storage' -czf ../assetown-src.tar.gz .
scp ../assetown-src.tar.gz ubuntu@IP_DE_LA_VM:/tmp/
```

Sur la VM :

```bash
sudo mkdir -p /opt/assetown && sudo chown ubuntu:ubuntu /opt/assetown
tar -xzf /tmp/assetown-src.tar.gz -C /opt/assetown
```

## 7. Migrer les données existantes

Depuis le PC (les comptes, builds, skins et le `secret.key` doivent suivre) :

```bash
scp -r apps/backend/storage ubuntu@IP_DE_LA_VM:/tmp/assetown-data
```

Sur la VM :

```bash
mkdir -p /opt/assetown/deploy/data
cp -a /tmp/assetown-data/. /opt/assetown/deploy/data/
sudo chown -R 1000:1000 /opt/assetown/deploy/data   # uid du user `node` dans le conteneur
```

> ⚠️ **Ne jamais perdre `data/secret.key`** : il signe les sessions et les liens de
> téléchargement. Sans lui, tous les joueurs doivent se reconnecter et les liens
> de builds en circulation deviennent invalides.

## 8. Configurer

```bash
cd /opt/assetown/deploy
cp .env.example .env
cp server.env.example server.env
nano .env          # DOMAIN=assetown-api.duckdns.org + ACME_EMAIL
nano server.env    # PUBLIC_BASE_URL (déjà le site routeur) + webhook + SMTP
```

`server.env` = l'ancien `.env` du PC. Reprends-en les valeurs utiles
(`DISCORD_WEBHOOK_URL`, `WEBHOOK_ENCRYPTION_KEY`, `INITIAL_ADMIN_*`, `SMTP_*`).
Ne mets **pas** `HOST=127.0.0.1` : compose force `0.0.0.0`.

## 9. Démarrer

```bash
cd /opt/assetown/deploy
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

Attendu dans les journaux : `Assetown API à l'écoute sur http://0.0.0.0:4200`.
Vérification directe sur la VM :

```bash
curl -s http://127.0.0.1/api/health   # → {"status":"ok",...}
curl -sI https://assetown-api.duckdns.org/api/health   # → HTTP/2 200
```

## 10. Basculer le routeur Cloudflare

Le site doit pointer vers la VM au lieu du tunnel du PC :

```bash
curl -X PUT "https://assetown-api-router-3e3dmn-preview.freebuff.site/api/health" # doit répondre 200 après bascule
```

Côté Sites → Secrets, remplace `API_UPSTREAM` par :

```
https://assetown-api.duckdns.org
```

Puis vérifie `https://assetown-api-router-3e3dmn-preview.freebuff.site/router.json`
(`"state": "online"`). Les launchers n'ont **rien** à changer : ils appellent
toujours le site routeur.

## 11. Éteindre le PC

Quand `router.json` est `online` avec la VM comme `upstream` :

- ferme la fenêtre `cloudflared` et le terminal `npm start` sur le PC ;
- ton PC peut être éteint : les `.exe` continuent de fonctionner.

## 12. Exploitation

| Besoin | Commande |
| --- | --- |
| Mettre à jour le code | renvoyer l'archive puis `docker compose up -d --build` |
| Sauvegarde | `tar -czf ~/assetown-$(date +%F).tar.gz -C /opt/assetown/deploy data` |
| Journaux | `docker compose logs -f api` (aussi `/opt/assetown/deploy/data/logs/server.log`) |
| Redémarrer | `docker compose restart api` |
| Diagnostic | `docker compose ps`, `docker compose logs caddy` |

**Sauvegarde automatique** (crontab `crontab -e`, tous les jours à 4 h) :

```cron
0 4 * * * cd /opt/assetown/deploy && tar -czf /home/ubuntu/backups/assetown-$(date +\%F).tar.gz data
```

Garde une copie hors de la VM (télécharge-la de temps en temps).

### Dépannage

| Symptôme | Cause probable |
| --- | --- |
| `router.json` → `offline` | `API_UPSTREAM` pas encore changé, ou Caddy sans certificat (`docker compose logs caddy`) |
| Certificat Let's Encrypt impossible | ports 80/443 fermés (Security List **ou** iptables), DNS DuckDNS pas à jour |
| `api` redémarre en boucle | `server.env` invalide, ou `/data` non accessible en écriture (uid 1000) |
| 403 sur un upload > 1 Mo | `request_body` du Caddyfile non appliqué (`docker compose restart caddy`) |
| Joueurs déconnectés après migration | `secret.key` non copié |
