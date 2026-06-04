{{/*
_helpers.tpl — "fonctions" réutilisables (templates nommés).
On les appelle ailleurs avec {{ include "..." . }} pour éviter de recopier
la même logique de nommage/labels dans chaque fichier.
*/}}

{{/* Nom de base = nom du service (app.name), nettoyé et tronqué à 63 car.
     (63 = limite des noms d'objets Kubernetes). */}}
{{- define "banquemssol.name" -}}
{{- default .Chart.Name .Values.app.name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Nom complet préfixé par le nom de la release Helm (évite les collisions
     si on installe le chart plusieurs fois). */}}
{{- define "banquemssol.fullname" -}}
{{- $name := default .Chart.Name .Values.app.name -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels communs à TOUTES les ressources (bonnes pratiques Kubernetes).
     Permettent de retrouver/filtrer les objets du chart. */}}
{{- define "banquemssol.labels" -}}
app.kubernetes.io/name: {{ include "banquemssol.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Labels de SÉLECTION : sous-ensemble STABLE des labels. Sert au Service
     (pour trouver ses pods) et au matchLabels du Deployment. Ne doit jamais
     contenir de label qui change (comme la version). */}}
{{- define "banquemssol.selectorLabels" -}}
app.kubernetes.io/name: {{ include "banquemssol.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Nom du ServiceAccount : celui fourni, sinon le fullname. */}}
{{- define "banquemssol.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "banquemssol.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
