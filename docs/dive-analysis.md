# Audit Dive — Banque-APIGateway

> Commande (mode CI, seuils imposés) :
> ```bash
> CI=true dive --source docker-archive /tmp/banquemssol-apigateway-local.tar --ci \
>   --lowestEfficiency 0.95 --highestWastedBytes 20MB --highestUserWastedPercent 0.10 \
>   | tee build-reports/dive-report.txt
> ```
> Rapports : [`build-reports/dive-report.txt`](../build-reports/dive-report.txt) ·
> [`dive-report.json`](../build-reports/dive-report.json).

## Résultat (image canonique `jammy`)

| Métrique | Valeur | Seuil CI | Verdict |
|---|---|---|---|
| Efficacité | **99.56 %** | ≥ 95 % | ✅ PASS |
| Espace gaspillé | **2.2 MB** | ≤ 20 MB | ✅ PASS |
| % gaspillé | **0.95 %** | ≤ 10 % | ✅ PASS |

`Result:PASS [Total:3] [Passed:3] [Failed:0]`

## Détail des couches (taille par layer)

| # | Taille | Origine |
|---|---|---|
| 0 | 74.4 MB | base jammy — rootfs Ubuntu |
| 1 | 40.9 MB | base jammy — `apt-get` (paquets système) |
| 2 | 134.7 MB | base jammy — installation du JDK Temurin 11 |
| 3 | 0 MB | base jammy — vérification install |
| 4 | 0.01 MB | base jammy — entrypoint cacert |
| 5 | 42.4 MB | **notre application** (couches Spring Boot extraites) |
| | **≈ 292 MB** | **total** |

**Lecture** : ~250 MB viennent de la **base** (dont 175 MB pour `apt` + JDK, couches 1-2),
et seulement **~42 MB de notre application**. Le poids de l'image est donc dominé par la
base, pas par le code — ce qui oriente toute optimisation vers le **choix de la base**.

## Fichiers superflus identifiés (les 2.2 MB gaspillés)

Dive liste des fichiers présents en double entre couches (modifiés/réécrits) :

```
1.4 MB  /var/cache/debconf/templates.dat
396 kB  /var/log/dpkg.log
322 kB  /var/log/lastlog
242 kB  /var/lib/dpkg/status
 42 kB  /var/log/apt/history.log
 ...    /var/log/*, /var/cache/*, /etc/ld.so.cache ...
```

Ce sont des **journaux et caches `apt`/`dpkg`/`debconf` de la base Ubuntu** — pas des
fichiers qu'on a ajoutés. Ils restent négligeables (2.2 MB, soit 0.95 %), bien en dessous
du seuil. Note : en supprimant le `useradd` (remplacé par un **UID numérique 1000**), on a
déjà éliminé la duplication de `/etc/passwd`, `/etc/shadow`, etc., ce qui a fait passer
l'efficacité de 99.45 % à **99.56 %**.

## Optimisations appliquées

1. **Multi-stage build** : les outils de build (extraction `layertools`) restent dans le
   stage *builder* ; l'image finale ne contient que le résultat. (Déjà en place.)
2. **Utilisateur non-root par UID numérique** (`USER 1000`) au lieu de `useradd` : enlève
   une couche *et* la duplication des fichiers `/etc/passwd|shadow|group`.
3. **Couches Spring Boot ordonnées** (dépendances → loader → snapshot → application) pour un
   meilleur cache au rebuild.

## Optimisation explorée : base Alpine (avant / après)

Le vrai levier de taille est la base. On a donc construit une variante Alpine :

```bash
buildah bud -t banquemssol-apigateway:alpine \
  --build-arg BASE_IMAGE=eclipse-temurin:11-jre-alpine \
  -f Containerfile.api_gateway Banque-APIGateway
```

| | `jammy` (retenue) | `alpine` (explorée) |
|---|---|---|
| Taille image | 312 MB | **218 MB** (−95 MB, −30 %) |
| Efficacité Dive | 99.56 % | 99.81 % |
| Gaspillage | 2.2 MB | 0.6 MB |
| **CVE OS (Trivy)** | **0** ✅ | **2 CRITICAL + 3 HIGH** ❌ (`gnutls 3.8.12`) |

### Décision : on garde `jammy`
Alpine gagne 95 MB, mais sa bibliothèque `gnutls` introduit **2 CVE CRITICAL**
(`CVE-2026-33845`, `CVE-2026-42010`) + 3 HIGH **absentes de jammy** — ce qui ferait
**échouer la gate Trivy**. Comme `jammy` passe déjà très largement la gate Dive
(99.56 % ≫ 95 %) **et** n'a aucune CVE OS, c'est le meilleur compromis
**taille / sécurité** ici. L'optimisation de taille n'est pas gratuite : elle peut
déplacer le problème vers la sécurité. La variante Alpine reste reproductible via
`--build-arg BASE_IMAGE` pour démonstration.

> Optimisation de taille plus poussée *sans* le revers CVE : viser une base **distroless**
> ou **Alpine avec `apk upgrade` de gnutls** quand le correctif `3.8.13-r0` sera dans le
> dépôt stable. Hors périmètre de ce TP.
