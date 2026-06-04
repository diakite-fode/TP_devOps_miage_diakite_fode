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
- [Partie B — Helm & Kubernetes (GitOps)](#partie-b--helm--kubernetes-gitops)
  - [B.1 — Chart Helm BanqueMSSol](#b1--chart-helm-banquemssol)
  - [B.2 — Déploiement dans Kubernetes](#b2--déploiement-dans-kubernetes)
  - [B.3 — GitOps avec ArgoCD](#b3--gitops-avec-argocd)
- [Lancer tout le projet en local (docker-compose)](#lancer-tout-le-projet-en-local-docker-compose)
- [🚀 Lancer le projet via la chaîne DevOps (pas à pas)](#-lancer-le-projet-via-la-chaîne-devops-pas-à-pas)

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

---

## Partie B — Helm & Kubernetes (GitOps)

On prend l'image de la Partie A et on la **déploie proprement sur Kubernetes** avec un chart
Helm, puis on automatise le déploiement en **GitOps** avec ArgoCD.

> ⚠️ **Nommage** : le **dossier du chart** s'appelle `BanqueMSSol/` (imposé par le TP) tandis
> que le **namespace Kubernetes** s'appelle `miage-bank`. Deux choses distinctes.

**Environnement local** : minikube (driver Docker) avec le CNI **Calico** (nécessaire pour
que les **NetworkPolicy soient réellement appliquées** — le CNI par défaut de minikube ne les
fait pas respecter). Ingress assuré par **Traefik** (installé via Helm). Secrets via **Vault**
+ **External Secrets Operator (ESO)**.

```bash
minikube start --cni=calico
minikube image load /tmp/apigateway-local.tar   # image OCI de la Partie A
helm repo add traefik https://traefik.github.io/charts
helm repo add external-secrets https://charts.external-secrets.io
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install traefik traefik/traefik -n traefik --create-namespace --set service.type=NodePort
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
helm install vault hashicorp/vault -n vault --create-namespace \
  --set "server.dev.enabled=true" --set "server.dev.devRootToken=root" --set "injector.enabled=false"
```

### B.1 — Chart Helm BanqueMSSol

Chart : **[`BanqueMSSol/`](BanqueMSSol/)**. Service de référence : l'API Gateway. Le chart est
**générique** (déployer un autre service = changer `image` / `app` / le secret dans
`values.yaml`). Ressources produites (toutes paramétrables) :

| Fichier | Ressource | Points clés (exigences TP) |
|---|---|---|
| `deployment.yaml` | Deployment | `readinessProbe` **+** `livenessProbe` (+ `startupProbe`), `resources.requests`/`limits`, `serviceAccountName` dédié, non-root |
| `service.yaml` | Service | **ClusterIP uniquement** |
| `ingress.yaml` | Ingress | classe **`traefik`**, `host` paramétrable, TLS optionnel (bonus) |
| `networkpolicy.yaml` | 2× NetworkPolicy | **default-deny** en entrée + autorisation **depuis le seul namespace Traefik** |
| `serviceaccount.yaml` | SA + Role + RoleBinding | **RBAC minimal** (lecture seule configmaps/secrets) |
| `externalsecret.yaml` | SecretStore + ExternalSecret | secrets tirés de **Vault** par **ESO** (rien en clair dans Git) |
| `configmap.yaml` | ConfigMap | config non sensible (port, exposition actuator) |
| `namespace.yaml` | Namespace | optionnel (`namespace.create`) |

Deux jeux de valeurs : **[`values.yaml`](BanqueMSSol/values.yaml)** (dev) et
**[`values-prod.yaml`](BanqueMSSol/values-prod.yaml)** (prod : 3 réplicas, image GHCR figée,
TLS activé). Validation **avant tout déploiement** :

```bash
helm lint BanqueMSSol/
helm template banquemssol BanqueMSSol/ -n miage-bank      # rend le YAML final
helm install banquemssol BanqueMSSol/ -n miage-bank --dry-run
```

### B.2 — Déploiement dans Kubernetes

**Gestion des secrets : Vault + ESO** (option recommandée par le TP). Le mot de passe vit dans
Vault ; ESO le lit et fabrique un Secret Kubernetes ; le pod le reçoit en variable
d'environnement. Configuration de Vault (auth Kubernetes liée au ServiceAccount du service) :

```bash
kubectl exec -n vault vault-0 -- sh -c '
  export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root
  vault kv put secret/banquemssol/apigateway demo-password="•••••"
  vault auth enable kubernetes
  vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc:443" \
    token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token \
    kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
  echo "path \"secret/data/banquemssol/*\" { capabilities = [\"read\"] }" | vault policy write banquemssol -
  vault write auth/kubernetes/role/banquemssol bound_service_account_names=banquemssol-apigateway \
    bound_service_account_namespaces=miage-bank policies=banquemssol ttl=1h'
```

Déploiement :

```bash
kubectl create namespace miage-bank
helm install banquemssol BanqueMSSol/ -n miage-bank
kubectl get all,ingress,networkpolicy -n miage-bank
```

**Validations obtenues :**

- **Pod `Ready` (1/1)**. *Subtilité rencontrée* : sans le Config Server, l'appli prenait le
  port Spring par défaut (8080) ; on force `SERVER_PORT=10000` (ConfigMap). Et comme Spring
  Boot met ~75 s à démarrer, un **`startupProbe`** évite que la liveness ne tue le pod trop tôt.
- **Accès via l'Ingress Traefik** : `HTTP 200` —
  `curl -H "Host: banquemssol.local" http://<traefik>/actuator/health` → `{"status":"UP"...}`.
- **NetworkPolicy active (preuve du blocage)** : un accès **direct** depuis un autre namespace
  échoue (timeout), alors que Traefik passe :
  ```bash
  kubectl run np-test --image=busybox -n default --rm -i --restart=Never -- \
    wget -T5 -qO- http://banquemssol-apigateway.miage-bank.svc:80/actuator/health
  # -> wget: download timed out   (bloqué par la NetworkPolicy / Calico)
  ```
- **Aucun secret en clair** : le pod a bien la variable issue de Vault, mais la valeur n'existe
  que dans Vault (le chart ne contient que des références : chemin + nom de clé).
  ```bash
  kubectl get externalsecret,secret -n miage-bank   # ExternalSecret READY=True, Secret créé par ESO
  ```

### B.3 — GitOps avec ArgoCD

**Œuf ou poule** : ArgoCD doit exister **avant** de gérer des apps. On l'installe d'abord, puis
on déclare une `Application` qui pointe sur ce dépôt.

```bash
kubectl create namespace argocd
kubectl apply --server-side -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl apply -f argocd/application.yaml      # voir argocd/application.yaml
```

L'`Application` (**[`argocd/application.yaml`](argocd/application.yaml)**) cible le dépôt, le
dossier `BanqueMSSol`, le namespace `miage-bank`, avec **`prune: true`** et **`selfHeal: true`**.

> **Branche** : le TP demande `main` ; ce dépôt utilise **`master`** comme branche par défaut,
> donc `targetRevision: master` (écart assumé et documenté).

Résultat : `kubectl get application banquemssol -n argocd` → **`Synced` / `Healthy`**.

> *Note minikube* : ArgoCD juge un Ingress « sain » seulement s'il a une **adresse**. Traefik en
> NodePort n'en publie pas par défaut ; on renseigne l'IP de minikube sur l'Ingress
> (`kubectl patch ingress ... --subresource=status`) pour obtenir `Healthy`.

**Démonstration de dérive (exigée) — `avant / pendant / après` :**

```bash
# 1) On modifie le cluster À LA MAIN (hors Git) : passer à 3 réplicas
kubectl scale deployment banquemssol-apigateway -n miage-bank --replicas=3
```

Observation en direct (`replicas` voulu + statut ArgoCD) :

```text
replicas=3  sync=Synced      <- juste après le scale manuel
replicas=1  sync=OutOfSync   <- ArgoCD détecte l'écart avec Git
replicas=1  sync=Synced      <- selfHeal a ramené à 1 (l'état décrit dans Git)
```

➡️ ArgoCD a **détecté la dérive (`OutOfSync`)** puis **réconcilié automatiquement** (`selfHeal`)
en quelques secondes : la modification manuelle est annulée, le cluster revient à l'état décrit
dans Git. C'est le principe même du GitOps.

> **Accès à l'UI ArgoCD** (facultatif) :
> ```bash
> kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
> kubectl port-forward -n argocd svc/argocd-server 8080:443   # https://localhost:8080 (admin)
> ```

---

## Lancer tout le projet en local (docker-compose)

> 🎯 But : faire tourner **toute l'application** (les 6 microservices + bases MySQL/MongoDB +
> Prometheus/Zipkin) **et le front-end**, en quelques commandes. C'est la voie la plus simple
> pour *utiliser* l'appli (différente de la chaîne DevOps qui, elle, déploie sur Kubernetes).
> `docker-compose.yml` gère tout : construction des images et ordre de démarrage.

### Prérequis

| Outil | Vérifier |
|---|---|
| **Docker** + **Docker Compose** | `docker --version` · `docker compose version` |
| **JDK 11** + **Maven** | `java -version` · `mvn -v` |
| **Node.js 18+** + **npm** (pour le front) | `node -v` · `npm -v` |

### 1. Cloner et compiler les JAR

Les images Docker de chaque service partent de `target/*.jar` : on compile d'abord.

```bash
git clone https://github.com/diakite-fode/TP_devOps_miage_diakite_fode.git
cd TP_devOps_miage_diakite_fode
mvn clean package -DskipTests
```

### 2. Démarrer tout le back-end (docker-compose)

```bash
docker compose up -d --build      # (ou : docker-compose up -d --build)
```

Le **premier** lancement prend quelques minutes (build + démarrage ordonné : Eureka →
Config Server → services → Gateway). Suivre l'avancement :

```bash
docker compose ps                 # tous les conteneurs doivent être "Up"
```

| Service | Accès |
|---|---|
| **API Gateway** (point d'entrée) | http://localhost:10000 |
| Eureka (annuaire) | http://localhost:10001 |
| Prometheus / Zipkin | http://localhost:9090 · http://localhost:9411 |

> Patiente que les services apparaissent **enregistrés dans Eureka** (http://localhost:10001)
> avant de tester l'API — la gateway route vers eux via Eureka.

### 3. Charger les jeux de données de test (copier/coller)

Crée 3 clients et 3 comptes via la gateway (rien à modifier, juste copier/coller) :

```bash
# --- 3 clients ---
curl -s -X POST http://localhost:10000/api/clients -H "Content-Type: application/json" -d '{"id":1,"nom":"Dupont","prenom":"Jean"}'
curl -s -X POST http://localhost:10000/api/clients -H "Content-Type: application/json" -d '{"id":2,"nom":"Martin","prenom":"Claire"}'
curl -s -X POST http://localhost:10000/api/clients -H "Content-Type: application/json" -d '{"id":3,"nom":"Diakite","prenom":"Fode"}'

# --- 3 comptes (idclient = à quel client appartient le compte) ---
curl -s -X POST http://localhost:10000/api/comptes -H "Content-Type: application/json" -d '{"id":100,"solde":1500.50,"idclient":1}'
curl -s -X POST http://localhost:10000/api/comptes -H "Content-Type: application/json" -d '{"id":101,"solde":320.00,"idclient":1}'
curl -s -X POST http://localhost:10000/api/comptes -H "Content-Type: application/json" -d '{"id":200,"solde":9999.99,"idclient":2}'
```

Vérifier que les données sont bien là :

```bash
curl http://localhost:10000/api/clients                 # liste des 3 clients
curl "http://localhost:10000/api/comptes?client=1"       # les 2 comptes du client 1
curl http://localhost:10000/api/clientscomptes/1         # client 1 AVEC ses comptes (service composite)
```

### 4. Lancer le front-end (React + Vite)

```bash
cd frontend
npm install        # une seule fois (installe les dépendances)
npm run dev
```

➡️ Ouvre **http://localhost:5173**. Le front proxifie automatiquement `/api` vers la gateway
(`http://localhost:10000`, cf. `frontend/vite.config.js`). Les onglets **Clients**, **Comptes**
et **Composite** affichent les données chargées à l'étape 3.

> 💡 Tu peux aussi créer des clients/comptes directement depuis les formulaires du front.

### 5. Arrêter / nettoyer

```bash
docker compose down        # arrête et supprime les conteneurs
docker compose down -v     # idem + supprime les volumes (remet les bases à zéro)
```

---

## 🚀 Lancer le projet via la chaîne DevOps (pas à pas)

> Procédure complète pour lancer le **service de référence (API Gateway)** en réutilisant la
> chaîne du TP : image OCI fabriquée avec **Buildah** (Partie A), déployée sur **Kubernetes**
> via le **chart Helm** et **ArgoCD** (Partie B). La fin explique comment **généraliser** aux
> autres microservices.

### Prérequis

| Outil | Vérifier | Rôle |
|---|---|---|
| **JDK 11** + **Maven** | `mvn -v` | compiler le `.jar` |
| **Buildah** | `buildah --version` | fabriquer l'image OCI |
| **minikube** + **kubectl** + **Helm** | `helm version` | cluster + déploiement |
| **ArgoCD CLI** *(facultatif)* | `argocd version --client` | GitOps |

### 1. Cloner et compiler le JAR

```bash
git clone https://github.com/diakite-fode/TP_devOps_miage_diakite_fode.git
cd TP_devOps_miage_diakite_fode
mvn -pl Banque-APIGateway -am package -DskipTests
```

### 2. Fabriquer l'image OCI avec Buildah (Partie A)

```bash
buildah bud -t banquemssol-apigateway:local \
  --build-arg APP_PORT=10000 \
  -f Containerfile.api_gateway Banque-APIGateway
```

### 3. Démarrer le cluster + la pile de support (Partie B)

`--cni=calico` est requis pour que les **NetworkPolicy** soient réellement appliquées.

```bash
minikube start --cni=calico
helm repo add traefik https://traefik.github.io/charts
helm repo add external-secrets https://charts.external-secrets.io
helm repo add hashicorp https://helm.releases.hashicorp.com ; helm repo update
helm install traefik traefik/traefik -n traefik --create-namespace --set service.type=NodePort
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
helm install vault hashicorp/vault -n vault --create-namespace \
  --set "server.dev.enabled=true" --set "server.dev.devRootToken=root" --set "injector.enabled=false"
```

### 4. Charger l'image dans minikube

L'image est locale (pas de registry) : on l'injecte dans le cluster.

```bash
buildah push banquemssol-apigateway:local \
  docker-archive:/tmp/apigateway.tar:banquemssol-apigateway:local
minikube image load /tmp/apigateway.tar
```

### 5. Alimenter Vault (secret + auth Kubernetes)

Le chart attend un secret fourni par Vault via ESO. On l'écrit et on configure l'auth K8s :

```bash
kubectl exec -n vault vault-0 -- sh -c '
  export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN=root
  vault kv put secret/banquemssol/apigateway demo-password="S3cr3t-Demo-Vault!"
  vault auth enable kubernetes
  vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc:443" \
    token_reviewer_jwt=@/var/run/secrets/kubernetes.io/serviceaccount/token \
    kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
  echo "path \"secret/data/banquemssol/*\" { capabilities = [\"read\"] }" | vault policy write banquemssol -
  vault write auth/kubernetes/role/banquemssol bound_service_account_names=banquemssol-apigateway \
    bound_service_account_namespaces=miage-bank policies=banquemssol ttl=1h'
```

> 💡 *Raccourci sans Vault* : pour un essai rapide, on peut désactiver les secrets externes et
> sauter les étapes Vault/ESO : ajouter `--set externalSecrets.enabled=false` au `helm install`.

### 6. Déployer (choisir UNE voie)

**Voie A — Helm (déploiement direct) :**
```bash
kubectl create namespace miage-bank
helm install banquemssol BanqueMSSol/ -n miage-bank
kubectl rollout status deployment/banquemssol-apigateway -n miage-bank
```

**Voie B — GitOps avec ArgoCD :**
```bash
kubectl create namespace argocd
kubectl apply --server-side -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl apply -f argocd/application.yaml      # synchronise depuis Git -> Synced / Healthy
```

### 7. Vérifier et accéder

```bash
kubectl get pods,svc,ingress,networkpolicy -n miage-bank
kubectl get externalsecret -n miage-bank            # READY=True (secret venu de Vault)

# accès HTTP via l'Ingress Traefik (port-forward, simple et portable)
kubectl port-forward -n traefik svc/traefik 8080:80 &
curl -H "Host: banquemssol.local" http://localhost:8080/actuator/health   # -> {"status":"UP"...}
```

### 🧩 Généraliser aux autres services

Le chart est **générique** : on déploie n'importe quel module en changeant 3 valeurs. Pour
chaque service, on refait les étapes 1–2–4 (build + chargement de l'image) puis :

```bash
# Exemple : ClientService (port 10011)
buildah bud -t banquemssol-clientservice:local --build-arg APP_PORT=10011 \
  -f Containerfile.api_gateway Banque-ClientService
buildah push banquemssol-clientservice:local docker-archive:/tmp/clientservice.tar:banquemssol-clientservice:local
minikube image load /tmp/clientservice.tar

helm install clientservice BanqueMSSol/ -n miage-bank \
  --set image.repository=banquemssol-clientservice \
  --set app.name=clientservice \
  --set app.containerPort=10011
```

Table de correspondance (module → port) :

| Service | Module | Port |
|---|---|---|
| annuaire (Eureka) | `Banque-Annuaire` | 10001 |
| configserver | `Banque-ConfigServer` | 10003 |
| clientservice | `Banque-ClientService` | 10011 |
| compteservice | `Banque-CompteService` | 10021 |
| compositeservice | `Banque-CompositeService` | 10031 |

> ⚠️ **À savoir pour un fonctionnement de bout en bout** : les services métier
> (client/compte/composite) ne sont pleinement opérationnels que s'ils retrouvent leurs
> **dépendances** — l'**Eureka** (annuaire), le **Config Server** (qui sert `Banque-configs/`)
> et leurs **bases** (MySQL/MongoDB). Il faut alors reproduire la topologie de
> `docker-compose.yml` côté Kubernetes : nommer les Services K8s comme les hôtes attendus
> (`bnkannuaire`, `bnkconfigsrv`, `bnkmysql`, `bnkmongo`) et activer
> `EUREKA_INSTANCE_PREFER_IP_ADDRESS=true` (pour qu'Eureka publie l'IP du pod). Le **service de
> référence (API Gateway)**, lui, démarre seul — c'est pourquoi le TP le déroule en détail.
