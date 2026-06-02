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

**Service de référence = Banque-APIGateway.** c'est le point
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
