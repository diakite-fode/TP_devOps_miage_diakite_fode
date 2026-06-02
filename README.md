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
| Taille | 313 MB | 312 MB |
| Couches (FS) | 6 | 6 |
| JAR | éclaté en 4 couches (deps/loader/snapshot/app) | fat-jar entier en 1 couche |
| Utilisateur | **non-root** (`spring`) ✅ | root (par défaut) ⚠️ |
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

**Résultat : 4 CRITICAL + 42 HIGH, *toutes* dans les dépendances Java de l'application**
(aucune CVE côté OS — la base `eclipse-temurin:11-jre-jammy` est saine). Cause racine
unique : **Spring Boot 2.6.4** (2022). La remédiation réelle est applicative (monter Spring
Boot à 2.7.18), hors périmètre de ce TP DevOps.

**Gate CRITICAL — abaissement documenté.** Choix retenu : *documenter & accepter* via
[`.trivyignore`](.trivyignore), qui liste **uniquement** les 3 CVE CRITICAL, chacune
justifiée comme **non exploitable** dans le contexte d'une gateway WebFlux/Netty
(Spring4Shell vise Spring MVC/Tomcat ; `HttpInvokerServiceExporter` non utilisé ; bypass
actuator propre à Cloud Foundry). La CI échoue donc toujours sur toute **nouvelle** CVE
CRITICAL non listée.

| Comportement de la gate | Commande | Exit |
|---|---|---|
| Sans ignore | `trivy ... --severity CRITICAL --ignorefile /dev/null --exit-code 1` | **1** (échoue) |
| Avec `.trivyignore` | `trivy ... --severity CRITICAL --exit-code 1` | **0** (passe) |
