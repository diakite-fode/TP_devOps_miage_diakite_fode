# Analyse comparative : Docker vs Buildah

> **Contexte** : dans ce TP, les images OCI du projet **BanqueMSSol** sont construites
> avec **Buildah** et non avec Docker. Ce document justifie ce choix sur 4 axes :
> architecture, sécurité, conformité OCI et usage en CI/CD.

## En une phrase

**Docker** est une plateforme complète qui repose sur un **démon** central tournant en
permanence avec les privilèges *root*. **Buildah** est un outil spécialisé qui construit
des images **sans démon** (« daemonless ») et peut tourner en simple utilisateur
(« rootless »). Pour *fabriquer* des images — surtout dans une CI — Buildah est plus léger
et plus sûr.

---

## 1. Architecture — démon vs daemonless

**Docker.** Quand on tape `docker build`, le client Docker (la commande) ne fait pas le
travail lui-même : il envoie la demande à un **démon** (`dockerd`), un processus qui tourne
en tâche de fond en permanence et qui orchestre tout (build, run, réseau, stockage). Ce
démon tourne en **root**. C'est un point central pratique, mais c'est aussi un **point
unique de défaillance** et un processus privilégié toujours actif, même quand on ne s'en
sert pas.

**Buildah.** Il n'y a **aucun démon**. `buildah` est une commande qui s'exécute, fait son
travail (construire l'image), puis se termine. Rien ne tourne en arrière-plan. Chaque build
est un processus isolé et éphémère. Conséquence directe : moins de ressources consommées au
repos, et pas de service privilégié permanent à surveiller.

> **Pourquoi ça compte ici** : sur un poste de dev ou un runner de CI, on veut juste
> *construire* une image de temps en temps. Un démon root permanent est une complexité —
> et un risque — dont on peut se passer.

---

## 2. Sécurité — surface d'attaque, socket Docker, rootless

C'est l'axe le plus décisif.

**Le socket Docker (`/var/run/docker.sock`).** Pour parler au démon, Docker expose un
socket Unix. Or **quiconque a accès à ce socket a, de fait, les droits root sur la machine
hôte** : il peut lancer un conteneur qui monte tout le disque de l'hôte et en prend le
contrôle. C'est un classique des escalades de privilèges. Dans une CI, monter ce socket
dans un conteneur de build (« Docker-in-Docker » via socket) revient à donner les clés de
la machine au job.

**Le démon root.** Comme `dockerd` tourne en root, une faille dans le démon = une faille
root sur l'hôte. La **surface d'attaque** est large : un seul processus privilégié gère
build, exécution, réseau, volumes…

**Buildah rootless.** Buildah peut construire des images **en tant qu'utilisateur normal**,
sans aucun privilège root, grâce aux *user namespaces* du noyau Linux (l'utilisateur est
« root » seulement à l'intérieur de son conteneur, jamais sur l'hôte). Pas de socket
privilégié à exposer, pas de démon root. Si le build est compromis, l'attaquant reste
cantonné aux droits de l'utilisateur — pas à ceux de la machine.

> Dans ce TP, `buildah info` confirme `rootless: true` : nos images sont fabriquées **sans
> jamais utiliser root sur l'hôte**. C'est exactement la garantie qu'on veut.

---

## 3. Conformité OCI — portabilité des images

**OCI** (*Open Container Initiative*) est le **standard ouvert** qui définit le format des
images et des conteneurs. Tant qu'une image respecte ce standard, elle fonctionne partout :
Docker, Podman, containerd, et surtout **Kubernetes**.

Buildah produit des images **conformes OCI** (c'est même son format par défaut ; il sait
aussi écrire au format historique « docker » si besoin). Concrètement, une image construite
ici avec Buildah :

- peut être poussée vers n'importe quel registry (Docker Hub, **GHCR**, Harbor…) ;
- peut être tirée et exécutée par Docker ou Podman sans aucune adaptation ;
- peut être déployée telle quelle sur Kubernetes en Partie B.

> **Pourquoi ça compte ici** : on construit avec Buildah en Partie A, mais on déploie sur
> Kubernetes en Partie B. La conformité OCI garantit que l'image passe d'un outil à l'autre
> **sans retouche**. On n'est pas « enfermé » dans l'écosystème d'un seul vendeur.

---

## 4. Cas d'usage CI/CD — pourquoi Buildah brille dans les pipelines

Dans une CI (GitHub Actions, GitLab CI, runners Kubernetes), les jobs tournent souvent
**eux-mêmes dans des conteneurs**. Construire une image *dans* un conteneur avec Docker pose
problème :

- soit on monte le socket Docker de l'hôte → **risque de sécurité majeur** (cf. axe 2) ;
- soit on lance un démon Docker imbriqué (« Docker-in-Docker ») → nécessite le mode
  **`--privileged`**, lourd et dangereux.

Buildah n'a **pas de démon** : il s'exécute directement dans le job, en mode rootless, sans
privilège spécial et sans socket à exposer. D'où :

- des pipelines **plus simples** (pas de service Docker à démarrer/attendre) ;
- des pipelines **plus sûrs** (pas de conteneur privilégié) ;
- une **intégration naturelle** avec les scanners (Trivy) et auditeurs (Dive) qu'on
  enchaîne juste après le build.

> **Pourquoi ça compte ici** : en A.5, on automatise tout dans **GitHub Actions**. Buildah
> s'y insère sans démon ni privilèges, ce qui rend la chaîne Hadolint → Buildah → Trivy →
> Dive propre et reproductible.

---

## Tableau de synthèse

| Critère | Docker | Buildah |
|---|---|---|
| **Architecture** | Démon `dockerd` permanent, en root | Daemonless : commande éphémère, rien en fond |
| **Privilèges** | Démon root ; socket = root sur l'hôte | Rootless possible (user namespaces) |
| **Surface d'attaque** | Large (un démon root gère tout) | Réduite (process isolé, sans privilège) |
| **Socket exposé** | `/var/run/docker.sock` (dangereux) | Aucun |
| **Format d'image** | OCI (et format docker) | OCI par défaut (portable partout) |
| **CI/CD conteneurisée** | Socket ou Docker-in-Docker `--privileged` | Rootless, sans démon ni privilège |
| **Périmètre** | Plateforme complète (build + run + réseau…) | Spécialisé : **construction** d'images |

---

## Conclusion — pourquoi Buildah pour BanqueMSSol

On choisit **Buildah** parce que, pour le besoin précis de ce TP — *fabriquer* des images
de microservices et les enchaîner dans une CI — il offre **le même résultat (images OCI
standard) avec moins de risques et moins de complexité** :

1. **Pas de démon root permanent** : moins de surface d'attaque, moins de ressources.
2. **Rootless** : on construit sans jamais être root sur l'hôte (confirmé par
   `buildah info → rootless: true`).
3. **Images OCI portables** : consommables par Docker, Podman et Kubernetes (Partie B) sans
   retouche.
4. **Idéal en CI/CD** : s'intègre dans GitHub Actions sans socket privilégié ni
   Docker-in-Docker, juste avant Trivy et Dive.

Docker reste excellent comme **plateforme tout-en-un** (notamment pour *exécuter* des
conteneurs en dev, ce qu'on utilise d'ailleurs encore via `docker-compose` pour lancer
l'infra locale). Mais pour la **construction d'images dans une démarche DevOps sécurisée et
automatisée**, Buildah est le meilleur choix.
