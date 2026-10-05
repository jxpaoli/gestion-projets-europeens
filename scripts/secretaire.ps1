# Outils du secrétaire (session Claude « secretaire-mails ») pour écrire dans l'appli Projets européens.
# Connexion avec le compte du secrétaire (rôle « secretaire ») : toutes les écritures passent par les règles
# de la base (RLS + triggers). Jamais de clé admin ici.
#
# Identifiants lus dans C:\Users\jxpao\Claude\Projects\secretaire-mails\.env.europa.local :
#   EUROPA_URL=https://<ref>.supabase.co
#   EUROPA_CLE_PUBLIQUE=sb_publishable_...
#   EUROPA_SECRETAIRE_EMAIL=...
#   EUROPA_SECRETAIRE_MDP=...
# Aucune valeur n'est jamais affichée.
#
# Usage (dot-source puis appeler les fonctions) :
#   . C:\Users\jxpao\Claude\Projects\gestion-projets-europeens\scripts\secretaire.ps1
#   $p = Debut-Passage -Du 2026-09-20 -Au 2026-09-25
#   Get-Projets
#   Nouvelle-Action -Projet JASON -Libelle "Relancer le LaMMA" -MailRef "VERSE-<unid>" -Source "#312 (24/09/2026, X) : …" `
#                   -DateSource "2026-09-24T10:12:00+02:00" -Expediteur "X" -Objet "RE: JASON – WP2" -Numero 312 -Echeance 2026-10-05
#   Cocher-Action -Id <uuid> -Source "#315 (25/09/2026, X) : reçu" -DateSource "2026-09-25T09:00:00+02:00" -Expediteur "X" -Objet "…" -MailRef "VERSE-<unid>"
#   Rouvrir-Action -Id <uuid> -Source "#318 (26/09/2026, X) : pas reçu" -DateSource "2026-09-26T08:30:00+02:00" -Expediteur "X" -Objet "…" -MailRef "VERSE-<unid>"
#   Ajouter-Source -Cible reunion -Id <uuid> -DateSource 2026-09-24 -Expediteur "X" -Objet "…" -MailRef "VERSE-<unid>" -Numero 312
# Chaque mail cité devient une « source » de l'élément : date, expéditeur et objet EXACT (Joseph le recherche
# dans sa messagerie à partir de l'objet). La base refuse une source mail sans date, expéditeur ou objet.
#   Commenter-Action -Id <uuid> -Message "Relance faite (mail du 25/09)"
#   Fin-Passage -Id $p.id -MailsLus 42 -Creees 3 -Faites 2 -Rouvertes 0 -Commentaires 1
#   $r = Nouvelle-Reunion -Projet "BLUE HUB" -Type cdp -Libelle "CdP n°4 – Portoferraio" -Date 2026-10-21 -LieuNom "Portoferraio" `
#                         -MailRef "VERSE-<unid>" -DateSource 2026-09-25 -Expediteur "X" -Objet "…" -Numero 312 [-HeureDebut 09:30 -Format presentiel]
#   Maj-Reunion -Id $r.id -HeureDebut 10:00 -Adresse "…"     (seulement ses propres réunions, jamais touchées par Joseph)
#   Get-Evolutions -Projet EASY2LOG
#   $e = Nouvelle-Evolution -Projet EASY2LOG -Date 2026-06-12 -Type retard -Element D1.3.1 -Titre "Rapport de cartographie repoussé" `
#                           -Avant "P3" -Apres "P4" -Motif "…" -Statut valide_cdp
#   (évolution qui ne vise qu'un autre partenaire : ajouter -AutrePartenaire ; correction : Maj-Evolution -Id … -ConcerneEpci $false)
#   Maj-Evolution -Id $e.id -Statut approuve        (jamais sur une entrée de Joseph ; jamais « abandonne »)
#   Ajouter-SourceDocument -Cible evolution -Id $e.id -Document "PV_CdP3.pdf"     (document indexé du projet)
#   Get-FichesProjet -Projet EASY2LOG
#   Deposer-FicheProjet -Projet EASY2LOG -Version 4.0 -Pdf "IF Marittimo00156_V4.0_EASY2LOG.pdf" -Json C:\...iche.json `
#                       -DateExport 2025-11-30 -Langue it -Partenaire "PP8 CCI de Corse (repris par l'EPCI de Corse)"
# Fiche projet = synthèse en français du dernier formulaire de candidature (forme du JSON : consigne du secrétaire
# et migration 202609280002_fiches_projet.sql). La base refuse une version pas plus récente, un PDF absent,
# et toute modification d'une fiche relue par Joseph.
param([string]$Fichier = "C:\Users\jxpao\Claude\Projects\secretaire-mails\.env.europa.local")

$ErrorActionPreference = "Stop"
$script:cfg = @{}
Get-Content $Fichier | Where-Object { $_ -match '^\s*[A-Z_]+=' } | ForEach-Object {
  $n, $v = $_ -split '=', 2
  $script:cfg[$n.Trim()] = $v.Trim().Trim('"')
}
foreach ($k in 'EUROPA_URL', 'EUROPA_CLE_PUBLIQUE', 'EUROPA_SECRETAIRE_EMAIL', 'EUROPA_SECRETAIRE_MDP') {
  if (-not $script:cfg[$k]) { throw "Variable $k absente ou vide dans $Fichier" }
}

function Connexion-Secretaire {
  $corps = @{ email = $script:cfg.EUROPA_SECRETAIRE_EMAIL; password = $script:cfg.EUROPA_SECRETAIRE_MDP } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Method Post -Uri "$($script:cfg.EUROPA_URL)/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $script:cfg.EUROPA_CLE_PUBLIQUE } -ContentType "application/json" -Body $corps
  $script:jeton = $r.access_token
  $script:expire = (Get-Date).AddSeconds($r.expires_in - 60)
}

# Appel à l'API de la base (schéma gestion_projets), réponse décodée en UTF-8.
function Api([string]$Methode, [string]$Chemin, $Corps = $null) {
  if (-not $script:jeton -or (Get-Date) -gt $script:expire) { Connexion-Secretaire }
  $h = @{
    apikey = $script:cfg.EUROPA_CLE_PUBLIQUE; Authorization = "Bearer $($script:jeton)"
    'Accept-Profile' = 'gestion_projets'; 'Content-Profile' = 'gestion_projets'; Prefer = 'return=representation'
  }
  $params = @{ UseBasicParsing = $true; Method = $Methode; Uri = "$($script:cfg.EUROPA_URL)/rest/v1/$Chemin"; Headers = $h }
  if ($null -ne $Corps) {
    # Un texte est envoyé tel quel (JSON déjà prêt, ex. contenu d'une fiche projet).
    $json = if ($Corps -is [string]) { $Corps } else { $Corps | ConvertTo-Json -Depth 5 -Compress }
    $params.ContentType = "application/json; charset=utf-8"
    $params.Body = [Text.Encoding]::UTF8.GetBytes($json)
  }
  try {
    $r = Invoke-WebRequest @params
  } catch {
    $msg = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    throw "Refusé par l'appli : $msg"
  }
  $texte = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
  # PowerShell 5.1 renvoie un tableau JSON comme un seul objet : on l'énumère pour avoir une vraie liste.
  if ($texte) { foreach ($x in ($texte | ConvertFrom-Json)) { $x } }
}

function Id-Projet([string]$Acronyme) {
  $p = Api GET "projets?select=id&acronyme=eq.$([uri]::EscapeDataString($Acronyme))"
  if (-not $p) { throw "Projet inconnu : $Acronyme" }
  $p[0].id
}

function Get-Projets { Api GET "projets?select=acronyme,dossier&actif=eq.true&order=acronyme" }

# Actions ouvertes (ou toutes avec -Toutes), pour retrouver un id avant de cocher / rouvrir / commenter.
function Get-Actions([string]$Projet, [switch]$Toutes) {
  $f = "actions?select=id,libelle,statut,echeance,responsable,valide_par,valide_le,modifie_par_admin,mail_ref&order=echeance.nullslast"
  if ($Projet) { $f += "&projet_id=eq.$(Id-Projet $Projet)" }
  if (-not $Toutes) { $f += "&statut=in.(a_faire,en_cours)" }
  Api GET $f
}

function Existe-Mail([string]$MailRef) {
  [bool](Api GET "actions?select=id&mail_ref=eq.$([uri]::EscapeDataString($MailRef))")
}

$script:ChampsCible = @{ action = 'action_id'; reunion = 'echeance_id'; point = 'point_id'; info = 'info_id'; evolution = 'evolution_id' }

# Source « mail » d'un élément (action, réunion, point, info). Un mail déjà cité sur le même élément est ignoré.
function Ajouter-Source {
  param([Parameter(Mandatory)][ValidateSet('action', 'reunion', 'point', 'info', 'evolution')][string]$Cible, [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$DateSource, [Parameter(Mandatory)][string]$Expediteur, [Parameter(Mandatory)][string]$Objet,
        [string]$MailRef, [int]$Numero)
  $champ = $script:ChampsCible[$Cible]
  $corps = @{ $champ = $Id; type = 'mail'; date_source = $DateSource.Substring(0, 10); expediteur = $Expediteur; objet = $Objet }
  if ($MailRef) { $corps.mail_ref = $MailRef }
  if ($Numero) { $corps.numero = $Numero }
  try { (Api POST "sources" $corps)[0] }
  catch { if ("$_" -match '23505') { Write-Host "Mail déjà cité sur cet élément : ignoré." } else { throw } }
}

function Nouvelle-Action {
  param([Parameter(Mandatory)][string]$Projet, [Parameter(Mandatory)][string]$Libelle, [Parameter(Mandatory)][string]$MailRef,
        [Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$DateSource,
        [Parameter(Mandatory)][string]$Expediteur, [Parameter(Mandatory)][string]$Objet, [int]$Numero,
        [string]$Echeance, [string]$Responsable, [ValidateSet('haute', 'normale', 'basse')][string]$Priorite = 'normale',
        [string]$Notes, [string]$Reunion)
  if (Existe-Mail $MailRef) { Write-Host "Déjà créée pour ce mail ($MailRef) : ignorée."; return }
  $corps = @{ projet_id = (Id-Projet $Projet); libelle = $Libelle; mail_ref = $MailRef; source = $Source
              derniere_source = $Source; derniere_source_date = $DateSource; priorite = $Priorite }
  if ($Echeance) { $corps.echeance = $Echeance }
  if ($Responsable) { $corps.responsable = $Responsable }
  if ($Notes) { $corps.notes = $Notes }
  if ($Reunion) { $corps.echeance_id = $Reunion }
  $a = (Api POST "actions" $corps)[0]
  $null = Ajouter-Source -Cible action -Id $a.id -DateSource $DateSource -Expediteur $Expediteur -Objet $Objet -MailRef $MailRef -Numero $Numero
  $a
}

function Cocher-Action {
  param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$DateSource,
        [Parameter(Mandatory)][string]$Expediteur, [Parameter(Mandatory)][string]$Objet, [string]$MailRef, [int]$Numero)
  $a = (Api PATCH "actions?id=eq.$Id" @{ statut = 'fait'; derniere_source = $Source; derniere_source_date = $DateSource })[0]
  $null = Ajouter-Source -Cible action -Id $Id -DateSource $DateSource -Expediteur $Expediteur -Objet $Objet -MailRef $MailRef -Numero $Numero
  $a
}

function Rouvrir-Action {
  param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$DateSource,
        [Parameter(Mandatory)][string]$Expediteur, [Parameter(Mandatory)][string]$Objet, [string]$MailRef, [int]$Numero)
  $a = (Api PATCH "actions?id=eq.$Id" @{ statut = 'a_faire'; derniere_source = $Source; derniere_source_date = $DateSource })[0]
  $null = Ajouter-Source -Cible action -Id $Id -DateSource $DateSource -Expediteur $Expediteur -Objet $Objet -MailRef $MailRef -Numero $Numero
  $a
}

function Commenter-Action([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Message) {
  (Api POST "actions_evenements" @{ action_id = $Id; type = 'commentaire'; message = $Message })[0]
}

# Réunions : retrouver l'échéance (CdP…) d'un projet, puis compléter sa fiche.
function Get-Reunions([string]$Projet) {
  $f = "echeances?select=id,type,libelle,date,lieu_nom&type=in.(cdp,evenement)&order=date"
  if ($Projet) { $f += "&projet_id=eq.$(Id-Projet $Projet)" }
  Api GET $f
}

function Ajouter-InfoReunion {
  param([Parameter(Mandatory)][string]$Reunion,
        [Parameter(Mandatory)][ValidateSet('transport', 'hebergement', 'repas', 'contact', 'acces', 'autre')][string]$Categorie,
        [Parameter(Mandatory)][string]$Titre, [Parameter(Mandatory)][string]$Source,
        [string]$Detail, [string]$Adresse, [string]$Telephone, [string]$Lien, [string]$Quand, [int]$Ordre = 50)
  $corps = @{ echeance_id = $Reunion; categorie = $Categorie; titre = $Titre; source = $Source; ordre = $Ordre }
  foreach ($k in 'Detail', 'Adresse', 'Telephone', 'Lien', 'Quand') { $v = Get-Variable $k -ValueOnly; if ($v) { $corps[$k.ToLower()] = $v } }
  (Api POST "reunion_infos" $corps)[0]
}

function Ajouter-PointReunion([Parameter(Mandatory)][string]$Reunion, [Parameter(Mandatory)][string]$Titre,
                              [Parameter(Mandatory)][string]$Source, [string]$Intervenant, [int]$Ordre = 50) {
  $corps = @{ echeance_id = $Reunion; titre = $Titre; source = $Source; ordre = $Ordre }
  if ($Intervenant) { $corps.intervenant = $Intervenant }
  (Api POST "reunion_points" $corps)[0]
}

# Journal des scans : un passage par scan de la messagerie. Get-DernierPassage donne le point de départ du suivant.
function Get-DernierPassage {
  Api GET "passages_secretaire?select=id,debut,fin,periode_du,periode_au,mails_lus&fin=not.is.null&order=debut.desc&limit=1"
}

function Debut-Passage([string]$Du, [string]$Au) {
  $corps = @{}
  if ($Du) { $corps.periode_du = $Du }
  if ($Au) { $corps.periode_au = $Au }
  (Api POST "passages_secretaire" $corps)[0]
}

function Fin-Passage([Parameter(Mandatory)][long]$Id, [int]$MailsLus, [int]$Creees, [int]$Faites, [int]$Rouvertes, [int]$Commentaires, [string]$Notes) {
  $corps = @{ fin = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); mails_lus = $MailsLus; actions_creees = $Creees
              actions_faites = $Faites; actions_rouvertes = $Rouvertes; commentaires = $Commentaires }
  if ($Notes) { $corps.notes = $Notes }
  (Api PATCH "passages_secretaire?id=eq.$Id" $corps)[0]
}

# Fiches projet : versions en base, la plus récente d'abord.
function Get-FichesProjet([Parameter(Mandatory)][string]$Projet) {
  Api GET "fiches_projet?select=id,version,date_export,document_nom,modifie_par_admin,ajoute_par,updated_at&projet_id=eq.$(Id-Projet $Projet)&order=version.desc"
}

# Dépose (ou remplace, si même version non relue par Joseph) la fiche d'un projet. -Json : fichier UTF-8 du contenu.
function Deposer-FicheProjet {
  param([Parameter(Mandatory)][string]$Projet, [Parameter(Mandatory)][decimal]$Version, [Parameter(Mandatory)][string]$Pdf,
        [Parameter(Mandatory)][string]$Json, [string]$DateExport, [string]$Langue = 'it', [string]$Partenaire)
  $projetId = Id-Projet $Projet
  $doc = Api GET "documents?select=id,nom&projet_id=eq.$projetId&present=eq.true&nom=eq.$([uri]::EscapeDataString($Pdf))"
  if (-not $doc) { throw "PDF introuvable dans l'index des documents : $Pdf (lancer indexer-documents.ps1 s'il vient d'être ajouté)" }
  $contenu = [IO.File]::ReadAllText((Resolve-Path $Json), [Text.Encoding]::UTF8).Trim([char]0xFEFF).Trim()
  $null = $contenu | ConvertFrom-Json   # erreur ici si le JSON est invalide
  $champs = @{ document_id = $doc[0].id; document_nom = $doc[0].nom; langue_origine = $Langue }
  if ($DateExport) { $champs.date_export = $DateExport }
  if ($Partenaire) { $champs.partenaire = $Partenaire }
  $v = $Version.ToString([Globalization.CultureInfo]::InvariantCulture)
  $existante = Api GET "fiches_projet?select=id,modifie_par_admin&projet_id=eq.$projetId&version=eq.$v"
  if ($existante) {
    if ($existante[0].modifie_par_admin) { throw "Fiche $Projet V$v relue par Joseph : ne pas la modifier." }
    $corps = ($champs | ConvertTo-Json -Compress).TrimEnd('}') + ',"contenu":' + $contenu + '}'
    (Api PATCH "fiches_projet?id=eq.$($existante[0].id)" $corps)[0] | Select-Object id, version, updated_at
  } else {
    $champs.projet_id = $projetId
    $corps = ($champs | ConvertTo-Json -Compress).TrimEnd('}') + ',"version":' + $v + ',"contenu":' + $contenu + '}'
    (Api POST "fiches_projet" $corps)[0] | Select-Object id, version, updated_at
  }
}

# Journal des évolutions : écarts avec le formulaire (retard, calendrier, budget, activité, livrable, partenariat, décision).
function Get-Evolutions([Parameter(Mandatory)][string]$Projet) {
  Api GET "evolutions?select=id,date_evolution,type,element,titre,avant,apres,statut,modifie_par_admin&projet_id=eq.$(Id-Projet $Projet)&order=date_evolution"
}

function Nouvelle-Evolution {
  param([Parameter(Mandatory)][string]$Projet, [Parameter(Mandatory)][string]$Date,
        [Parameter(Mandatory)][ValidateSet('retard', 'calendrier', 'budget', 'activite', 'livrable', 'partenariat', 'decision', 'autre')][string]$Type,
        [Parameter(Mandatory)][string]$Titre, [string]$Element, [string]$Avant, [string]$Apres, [string]$Motif,
        [ValidateSet('constate', 'propose', 'valide_cdp', 'approuve', 'integre')][string]$Statut = 'constate', [decimal]$VersionIntegree,
        [switch]$AutrePartenaire)
  $projetId = Id-Projet $Projet
  # Pas de doublon : même projet, même date, même titre.
  $deja = Api GET "evolutions?select=id&projet_id=eq.$projetId&date_evolution=eq.$Date&titre=eq.$([uri]::EscapeDataString($Titre))"
  if ($deja) { Write-Host "Déjà notée : $Titre ($Date)"; return $deja[0] }
  $corps = @{ projet_id = $projetId; date_evolution = $Date; type = $Type; titre = $Titre; statut = $Statut }
  foreach ($k in 'Element', 'Avant', 'Apres', 'Motif') { $v = Get-Variable $k -ValueOnly; if ($v) { $corps[$k.ToLower()] = $v } }
  if ($VersionIntegree) { $corps.version_integree = $VersionIntegree }
  if ($AutrePartenaire) { $corps.concerne_epci = $false }   # visé : un autre partenaire seulement (grisé dans le rapport)
  (Api POST "evolutions" $corps)[0]
}

function Maj-Evolution {
  param([Parameter(Mandatory)][string]$Id, [ValidateSet('constate', 'propose', 'valide_cdp', 'approuve', 'integre')][string]$Statut,
        [string]$Apres, [string]$Motif, [decimal]$VersionIntegree, [Nullable[bool]]$ConcerneEpci)
  $corps = @{}
  if ($Statut) { $corps.statut = $Statut }
  if ($Apres) { $corps.apres = $Apres }
  if ($Motif) { $corps.motif = $Motif }
  if ($VersionIntegree) { $corps.version_integree = $VersionIntegree }
  if ($null -ne $ConcerneEpci) { $corps.concerne_epci = [bool]$ConcerneEpci }
  (Api PATCH "evolutions?id=eq.$Id" $corps)[0]
}

# Source « document » (PV, demande de modification, annexe…) : document indexé du projet, retrouvé par son nom exact.
function Ajouter-SourceDocument {
  param([Parameter(Mandatory)][ValidateSet('action', 'reunion', 'point', 'info', 'evolution')][string]$Cible,
        [Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Document)
  $doc = Api GET "documents?select=id,nom&present=eq.true&nom=eq.$([uri]::EscapeDataString($Document))"
  if (-not $doc) { throw "Document introuvable dans l'index : $Document" }
  $champ = $script:ChampsCible[$Cible]
  $existe = Api GET "sources?select=id&$champ=eq.$Id&document_id=eq.$($doc[0].id)"
  if ($existe) { Write-Host "Document déjà cité sur cet élément : ignoré."; return }
  (Api POST "sources" @{ $champ = $Id; type = 'document'; document_id = $doc[0].id; objet = $doc[0].nom })[0]
}

# Réunions (CdP, événements) annoncées par mail : création avec la source du mail ; pas de doublon (même projet,
# type et date) ; jamais d'annulation ni de suppression (Joseph).
function Nouvelle-Reunion {
  param([Parameter(Mandatory)][string]$Projet, [Parameter(Mandatory)][ValidateSet('cdp', 'evenement')][string]$Type,
        [Parameter(Mandatory)][string]$Libelle, [Parameter(Mandatory)][string]$Date,
        [Parameter(Mandatory)][string]$MailRef, [Parameter(Mandatory)][string]$DateSource,
        [Parameter(Mandatory)][string]$Expediteur, [Parameter(Mandatory)][string]$Objet, [int]$Numero,
        [string]$HeureDebut, [string]$HeureFin, [string]$LieuNom, [string]$Adresse,
        [ValidateSet('presentiel', 'hybride', 'distanciel', 'ecrit')][string]$Format, [string]$LienVisio, [string]$Notes)
  $projetId = Id-Projet $Projet
  $deja = Api GET "echeances?select=id,libelle,date&projet_id=eq.$projetId&type=eq.$Type&date=eq.$Date&statut=neq.annule"
  if ($deja) { Write-Host "Réunion déjà dans l'appli : $($deja[0].libelle) ($Date)"; return $deja[0] }
  $corps = @{ projet_id = $projetId; type = $Type; libelle = $Libelle; date = $Date; mail_ref = $MailRef }
  $champs = @{ HeureDebut = 'heure_debut'; HeureFin = 'heure_fin'; LieuNom = 'lieu_nom'; Adresse = 'adresse'; Format = 'format'; LienVisio = 'lien_visio'; Notes = 'notes' }
  foreach ($k in $champs.Keys) { $v = Get-Variable $k -ValueOnly; if ($v) { $corps[$champs[$k]] = $v } }
  $r = (Api POST "echeances" $corps)[0]
  $null = Ajouter-Source -Cible reunion -Id $r.id -DateSource $DateSource -Expediteur $Expediteur -Objet $Objet -MailRef $MailRef -Numero $Numero
  $r
}

function Maj-Reunion {
  param([Parameter(Mandatory)][string]$Id, [string]$Libelle, [string]$Date, [string]$HeureDebut, [string]$HeureFin,
        [string]$LieuNom, [string]$Adresse, [ValidateSet('presentiel', 'hybride', 'distanciel', 'ecrit')][string]$Format,
        [string]$LienVisio, [string]$Notes)
  $corps = @{}
  $champs = @{ Libelle = 'libelle'; Date = 'date'; HeureDebut = 'heure_debut'; HeureFin = 'heure_fin'; LieuNom = 'lieu_nom'
               Adresse = 'adresse'; Format = 'format'; LienVisio = 'lien_visio'; Notes = 'notes' }
  foreach ($k in $champs.Keys) { $v = Get-Variable $k -ValueOnly; if ($v) { $corps[$champs[$k]] = $v } }
  if (-not $corps.Count) { throw "Rien à modifier" }
  (Api PATCH "echeances?id=eq.$Id" $corps)[0]
}
