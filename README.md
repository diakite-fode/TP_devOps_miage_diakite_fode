# BanqueMSSol — TP DevOps (build OCI, sécurité, Helm, GitOps)

Projet bancaire en **microservices Spring Cloud**. Ce dépôt contient l'application **et**
la chaîne DevOps demandée par le TP.

- **Partie A** — fabriquer une image de conteneur propre et sûre (Buildah → Trivy → Dive),
  puis automatiser le tout en CI (GitHub Actions).
- **Partie B** — déployer sur Kubernetes avec Helm, puis en GitOps avec ArgoCD.

> Service de référence retenu pour dérouler le TP en détail : **Banque-APIGateway**
> (point d'entrée unique, sans dépendance base de données).

## Sommaire

- [Architecture & inventaire des modules](#architecture--inventaire-des-modules)
- [Prérequis outils](#prérequis-outils)
- [Partie A — Chaîne de build OCI](#partie-a--chaîne-de-build-oci)
  - [A.1 — Docker vs Buildah](#a1--docker-vs-buildah)
  - [A.2 — Build de l'image avec Buildah](#a2--build-de-limage-avec-buildah)
  - [A.3 — Scan de sécurité avec Trivy](#a3--scan-de-sécurité-avec-trivy)
  - [A.4 — Audit de l'image avec Dive](#a4--audit-de-limage-avec-dive)
  - [A.5 — Chaîne CI (GitHub Actions)](#a5--chaîne-ci-github-actions)

---

## Architecture & inventaire des modules

Le `pom.xml` parent (`ExempleMicroServices`) agrège **6 modules** Maven :

| Module | Rôle | Port | Stockage |
|---|---|---|---|
| **Banque-Annuaire** | Eureka Server (annuaire de services) | `10001` | — |
| **Banque-ConfigServer** | Config Server (config centralisée, lit `Banque-configs/`) | `10003` | — |
| **Banque-APIGateway** | API Gateway (point d'entrée `/api/**`) | `10000` | — |
| **Banque-ClientService** | Service métier *clients* | `10011` | MySQL |
| **Banque-CompteService** | Service métier *comptes* | `10021` | MongoDB |
| **Banque-CompositeService** | Service composite *clients+comptes* (OpenFeign) | `10031` | — |

Infrastructure annexe (lancée via `docker-compose.yml`, ce ne sont **pas** des modules
Maven) : MySQL, MongoDB, Prometheus, Zipkin.

**Service de référence = Banque-APIGateway.** 
c'est le point
d'entrée unique, il n'a **pas besoin d'une base de données** pour démarrer (contrairement
aux services clients/comptes), donc l'image est simple à construire, scanner et auditer.
La chaîne est détaillée sur ce service, puis **généralisée** aux autres modules via une
**matrice** GitHub Actions (un build par service, même recette, seul le dossier du module
et le port changent — voir A.5).

---

## Prérequis outils

| Outil | Rôle | Statut |
|---|---|---|
| **Buildah** | Construire les images OCI (sans démon, rootless) | ✅ 1.33.7 |
| **Trivy** | Scanner les failles (CVE) des images | ✅ 0.71.0 |
| **Dive** | Auditer les couches / la taille des images | ✅ 0.13.1 |
| **Hadolint** | Linter (qualité) du Containerfile | ✅ 2.14.0 |
| **Helm** | Packager / déployer sur Kubernetes | ✅ 3.20.0 |
| **kubectl** | Piloter le cluster Kubernetes | ✅ 1.28.2 |
| **ArgoCD CLI** | GitOps (synchronisation Git → cluster) | ✅ 3.4.3 |
| **minikube** | Cluster Kubernetes local | ✅ 1.38.1 |
| **Git / GitHub** | Versionnement + rendu (Pull Request) | ✅ |

> Environnement : WSL2 Ubuntu 24.04, Java 11, Maven 3.8.7. Buildah, Trivy, Dive, Hadolint
> et ArgoCD ont été installés au début du TP (les 4 derniers en binaires utilisateur dans
> `~/.local/bin`, Buildah via `apt`).

---

## Partie A — Chaîne de build OCI

### A.1 — Docker vs Buildah

Analyse comparative complète (4 axes : architecture, sécurité, conformité OCI, CI/CD) et
justification du choix de Buildah : **[docs/docker-vs-buildah.md](docs/docker-vs-buildah.md)**.

**Résumé du choix** : pour *fabriquer* des images dans une démarche DevOps sécurisée et
automatisée, Buildah donne le même résultat que Docker (images **OCI** standard) avec moins
de risques — **pas de démon root permanent**, **mode rootless**, **pas de socket
`/var/run/docker.sock`** à exposer — et s'intègre sans privilège dans une CI. Preuve du mode
rootless sur cette machine :

```text
$ buildah info
  rootless:        true
  GraphDriverName: overlay
  RunRoot:         /run/user/1000/containers   # espace utilisateur, pas root
```

> Docker reste utilisé pour *exécuter* l'infra locale (`docker-compose`), mais la
> **construction** des images du TP passe exclusivement par Buildah.

### A.2 — Build de l'image avec Buildah

Recette de build : **[Containerfile.api_gateway](Containerfile.api_gateway)** (multi-stage,
utilisateur non-root). Informations lues dans le projet (non devinées) :
JAR = `Banque-APIGateway/target/Banque-APIGateway-7.0.jar`, port applicatif = `10000`
(`Banque-configs/apigateway-dev.yml`).

> **Note registry** : Buildah rootless refuse les noms d'image « courts » par sécurité. On
> déclare donc Docker Hub comme registry par défaut dans
> `~/.config/containers/registries.conf` (`unqualified-search-registries = ["docker.io"]`).

**Approche 1 — via le Containerfile** (recommandée, reproductible) :

```bash
buildah bud -t banquemssol-apigateway:local \
  --build-arg APP_PORT=10000 \
  -f Containerfile.api_gateway Banque-APIGateway
```

`bud` = *build using Dockerfile* · `-t` = nom:tag · `--build-arg` = valeur d'un `ARG` ·
`-f` = la recette · `Banque-APIGateway` = le **contexte** (dossier d'origine des `COPY`).

**Approche 2 — layer-par-layer (mode natif, sans Containerfile)** : montre ce que fait un
Containerfile « sous le capot ».

```bash
ctr=$(buildah from eclipse-temurin:11-jre-jammy)          # conteneur de travail
buildah copy $ctr Banque-APIGateway/target/Banque-APIGateway-7.0.jar /app/app.jar
buildah config --port 10000 \
  --entrypoint '["java","-jar","/app/app.jar"]' $ctr       # config exécution
buildah commit $ctr banquemssol-apigateway:native          # fige en image
buildah rm $ctr
```

**Comparaison des deux approches :**

| Critère | `:local` (Containerfile multi-stage) | `:native` (layer-par-layer) |
|---|---|---|
| Taille | 312 MB | 312 MB |
| Couches (FS) | 6 | 6 |
| JAR | éclaté en 4 couches (deps/loader/snapshot/app) | fat-jar entier en 1 couche |
| Utilisateur | **non-root** (UID 1000) ✅ | root (par défaut) ⚠️ |
| Lisibilité | recette versionnée, auto-documentée ✅ | commandes impératives |
| Reproductibilité | élevée (le fichier = source de vérité) ✅ | dépend du script |
| Cache au rebuild | bon (seule la couche *app* change) ✅ | faible (couche jar refaite) |

**Constat :** les deux images font ~312 MB — le multi-stage ne réduit *presque pas* la
taille ici, car le JAR est déjà compilé et les deux partent de la même base `jammy`. Le
multi-stage apporte surtout **non-root**, **cache** et **reproductibilité**. Le vrai levier
sur la taille est l'**image de base** : démontré en A.4 (Dive, comparatif avant/après).

**Généralisation aux autres modules.** Même recette pour les 6 services : seuls le
**contexte** (dossier du module) et `APP_PORT` changent. Le JAR est toujours dans
`<module>/target/*.jar`. Le script `build.sh` automatise le build du service de référence ;
la CI (A.5) généralise via une **matrice** (un build par service).

### A.3 — Scan de sécurité avec Trivy

Analyse complète des CVE (faille + remédiation par CVE) :
**[docs/trivy-cve-analysis.md](docs/trivy-cve-analysis.md)**.
Rapports bruts : [`build-reports/trivy-report.json`](build-reports/trivy-report.json),
[`.sarif`](build-reports/trivy-report.sarif) (lisible par l'onglet *Security* de GitHub),
[`.txt`](build-reports/trivy-report.txt).

> **Nuance Buildah** : Trivy ne lit pas directement le stockage rootless de Buildah. On
> exporte donc l'image en archive puis on la scanne :
> ```bash
> buildah push banquemssol-apigateway:local \
>   docker-archive:/tmp/banquemssol-apigateway-local.tar:banquemssol-apigateway:local
> trivy image --input /tmp/banquemssol-apigateway-local.tar \
>   --severity HIGH,CRITICAL --format json --output build-reports/trivy-report.json
> ```

**Résultat (service de référence API Gateway) : 4 CRITICAL + 42 HIGH, *toutes* dans les
dépendances Java de l'application** (aucune CVE côté OS — la base
`eclipse-temurin:11-jre-jammy` est saine). Cause racine unique : **Spring Boot 2.6.4** (2022).
La remédiation réelle est applicative (monter Spring Boot à 2.7.18), hors périmètre de ce TP
DevOps.

**Gate CRITICAL — abaissement documenté.** Choix retenu : *documenter & accepter* via
[`.trivyignore`](.trivyignore), classé en **deux groupes** (chaque CVE expliquée en langage
simple dans le fichier) :
- **API Gateway (3 CVE)** : **non exploitables** ici (WebFlux/Netty, pas de Tomcat) —
  Spring4Shell vise Spring MVC/Tomcat, `HttpInvokerServiceExporter` non utilisé, bypass
  actuator propre à Cloud Foundry.
- **Services servlet (7 CVE)** — Annuaire, ConfigServer, ClientService, CompteService,
  CompositeService : eux utilisent Tomcat, donc ces failles **sont** dans du code utilisé.
  On les **accepte avec mitigation** (correctif = monter Spring Boot/Tomcat, hors périmètre ;
  services exposés en interne seulement, derrière la gateway + NetworkPolicy en Partie B).

La CI échoue donc toujours sur toute **nouvelle** CVE CRITICAL non listée. Détail par CVE :
[docs/trivy-cve-analysis.md](docs/trivy-cve-analysis.md).

| Comportement de la gate | Commande | Exit |
|---|---|---|
| Sans ignore | `trivy ... --severity CRITICAL --ignorefile /dev/null --exit-code 1` | **1** (échoue) |
| Avec `.trivyignore` | `trivy ... --severity CRITICAL --exit-code 1` | **0** (passe) |

### A.4 — Audit de l'image avec Dive

Analyse détaillée (couches, fichiers superflus, optimisation avant/après) :
**[docs/dive-analysis.md](docs/dive-analysis.md)**. Rapports :
[`build-reports/dive-report.txt`](build-reports/dive-report.txt),
[`dive-report.json`](build-reports/dive-report.json).

```bash
CI=true dive --source docker-archive /tmp/banquemssol-apigateway-local.tar --ci \
  --lowestEfficiency 0.95 --highestWastedBytes 20MB --highestUserWastedPercent 0.10 \
  | tee build-reports/dive-report.txt
```

`--ci` = pas d'interface, validation automatique · `--lowest/highest…` = seuils qui font
échouer si l'image est mauvaise · `tee` = afficher **et** enregistrer.

**Résultat (image `jammy`) : `PASS` sur les 3 seuils** — efficacité **99.56 %** (≥ 95 %),
gaspillage **2.2 MB** (≤ 20 MB), **0.95 %** (≤ 10 %). Les ~2 MB gaspillés sont des
journaux/caches `apt`/`dpkg` de la base (négligeables). Sur ~292 MB, **~250 MB viennent de
la base** et seulement ~42 MB de l'application.

**Optimisation avant/après (base de l'image, le vrai levier de taille) :**

| | `jammy` (retenue) | `alpine` (explorée) |
|---|---|---|
| Taille | 312 MB | **218 MB** (−30 %) |
| Efficacité Dive | 99.56 % | 99.81 % |
| **CVE OS (Trivy)** | **0** ✅ | **2 CRITICAL + 3 HIGH** (`gnutls`) ❌ |

> **Leçon** : optimiser la taille n'est pas gratuit. Alpine gagne 95 MB mais réintroduit
> 2 CVE CRITICAL OS (`gnutls`) qui feraient échouer la gate Trivy. On **garde `jammy`**
> (meilleur compromis taille/sécurité). Optimisations déjà appliquées : multi-stage,
> `USER 1000` (non-root, sans `useradd`), couches Spring Boot ordonnées.

### A.5 — Chaîne CI (GitHub Actions)

Pipeline : **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)**. Se déclenche à chaque
push / PR et, **pour chaque microservice** (via une **matrice**), enchaîne dans l'ordre :

1. **Compilation Maven** du JAR (`mvn -pl <module> -am package -DskipTests`).
2. **Hadolint** — lint du Containerfile.
3. **Buildah** — build de l'image (`--storage-driver=vfs`, robuste en CI rootless).
4. **Trivy** — rapports complets (JSON + SARIF + table) **puis gate** : `--exit-code 1` sur
   `--severity CRITICAL` avec `.trivyignore` → **la CI échoue sur toute CVE CRITICAL non
   acceptée**.
5. **Dive** — audit avec les seuils imposés (efficacité ≥ 95 %, gaspillage ≤ 20 MB / 10 %).
6. **Publication** : rapports en **artifacts** (`build-reports-<service>`) + **SARIF** poussé
   dans l'onglet *Security* (Code scanning).

**Stratégie multi-module (matrice).** Plutôt que dupliquer le YAML 6 fois, la `matrix`
exécute le **même job** une fois par service ; seuls `module` (dossier) et `port` changent.
Le même `Containerfile.api_gateway` (générique) sert aux 6 images.

```yaml
matrix:
  include:
    - { name: apigateway,       module: Banque-APIGateway,       port: 10000 }
    - { name: annuaire,         module: Banque-Annuaire,         port: 10001 }
    - { name: configserver,     module: Banque-ConfigServer,     port: 10003 }
    - { name: clientservice,    module: Banque-ClientService,    port: 10011 }
    - { name: compteservice,    module: Banque-CompteService,    port: 10021 }
    - { name: compositeservice, module: Banque-CompositeService, port: 10031 }
```

> La gate Trivy raisonne par **identifiant de CVE** : le `.trivyignore` (commun aux 6 jobs)
> liste les CRITICAL acceptées — 3 pour la gateway, 7 de plus pour les services servlet
> (Tomcat/Spring), toutes héritées de Spring Boot 2.6.4. Chaque job ne « consomme » que les
> CVE réellement présentes dans son image. Toute **nouvelle** CRITICAL non listée ferait
> échouer **ce** job uniquement (les autres continuent grâce à `fail-fast: false`).
