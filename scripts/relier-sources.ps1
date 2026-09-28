# Relie le texte « source » des actions à des sources structurées :
# - mails cités par numéro (« #300 », « #422-#456 ») → date, expéditeur, objet, identifiant, lus dans
#   <projet>\data\index-mails.csv ; « index EASY2LOG #388 » renvoie à l'index d'un autre projet (jusqu'au « ; ») ;
# - documents cités par leur nom (« …_V4.0_GREENBAY.pdf ») → document indexé du projet (lien OneDrive).
# Les objets et expéditeurs restent en base et dans OneDrive, jamais dans le dépôt.
# Relançable sans risque : un mail ou un document déjà relié à une action est ignoré.
# Usage : .\scripts\relier-sources.ps1 [-Simulation]
param([string]$Racine = "$env:USERPROFILE\OneDrive - EPCI DE CORSE\Projets européens", [switch]$Simulation)

$ErrorActionPreference = "Stop"
$sql = Join-Path $PSScriptRoot "sql.ps1"
$actions = & $sql -ReadOnly -Query @"
select a.id, a.source, p.acronyme, p.dossier from gestion_projets.actions a join gestion_projets.projets p on p.id = a.projet_id
where a.source ~ '#[0-9]' and p.dossier is not null
"@ | ConvertFrom-Json
# Acronyme → dossier, pour « index <ACRONYME> #n ».
$dossiers = @{}
foreach ($p in (& $sql -ReadOnly -Query "select acronyme, dossier from gestion_projets.projets where dossier is not null" | ConvertFrom-Json)) {
  $dossiers[$p.acronyme.ToUpper()] = $p.dossier
}

# Index des mails d'un projet, par numéro. Séparateur « ; » ou « , » selon le projet ; colonne expéditeur au nom variable.
$index = @{}
function Index-Projet([string]$dossier) {
  if ($index.ContainsKey($dossier)) { return $index[$dossier] }
  $f = Join-Path $Racine "$dossier\data\index-mails.csv"
  $t = @{}
  if (Test-Path -LiteralPath $f) {
    $entete = (Get-Content -LiteralPath $f -Encoding UTF8 -TotalCount 1)
    $sep = if ($entete.Split(';').Count -gt $entete.Split(',').Count) { ';' } else { ',' }
    $lignes = @(Import-Csv -LiteralPath $f -Delimiter $sep -Encoding UTF8)
    if ($lignes.Count) {
      $colExp = ($lignes[0].PSObject.Properties.Name | Where-Object { $_ -like 'expediteur*' } | Select-Object -First 1)
      foreach ($l in $lignes) {
        if ($l.n -match '^\d+$') { $t[[int]$l.n] = @{ date = $l.date; expediteur = $l.$colExp; objet = $l.objet; unid = $l.unid } }
      }
    }
  } else { Write-Warning "Index absent : $f" }
  $index[$dossier] = $t
  $t
}

function Q([string]$v) { if ([string]::IsNullOrWhiteSpace($v)) { 'null' } else { "'" + $v.Trim().Replace("'", "''") + "'" } }

$valeurs = New-Object System.Collections.Generic.List[string]
$introuvables = New-Object System.Collections.Generic.List[string]
foreach ($a in $actions) {
  $cites = New-Object System.Collections.Generic.List[object]
  foreach ($segment in $a.source -split ';') {
    $dossier = $a.dossier
    $autre = [regex]::Match($segment, '(?i)\bindex\s+([A-Z0-9][A-Z0-9 ]*?)\s*(?:#|,|:|$)')
    if ($autre.Success -and $dossiers[$autre.Groups[1].Value.Trim().ToUpper()]) { $dossier = $dossiers[$autre.Groups[1].Value.Trim().ToUpper()] }
    foreach ($m in [regex]::Matches($segment, '#(\d+)(?:\s*-\s*#?(\d+))?')) {
      $de = [int]$m.Groups[1].Value
      $a_ = if ($m.Groups[2].Success) { [int]$m.Groups[2].Value } else { $de }
      # Plage longue (« #422-#456 ») : seuls ses deux bouts, pour ne pas noyer l'action sous les mails.
      $liste = if ($a_ - $de -le 10) { $de..$a_ } else { @($de, $a_) }
      foreach ($n in $liste) {
        if (-not ($cites | Where-Object { $_.n -eq $n -and $_.dossier -eq $dossier })) { $cites.Add(@{ n = $n; dossier = $dossier }) }
      }
    }
  }
  foreach ($c in $cites) {
    $n = $c.n
    $mail = (Index-Projet $c.dossier)[$n]
    if (-not $mail) { $introuvables.Add("$($c.dossier) #$n"); continue }
    $ref = if ($mail.unid) { "VERSE-$($mail.unid)" } else { "INDEX-$($c.dossier)-$n" }
    $valeurs.Add("('$($a.id)', 'mail', $(Q $mail.date), $(Q $mail.expediteur), $(Q $mail.objet), $(Q $ref), $n, 'systeme')")
  }
}

"$($actions.Count) actions citent des mails ; $($valeurs.Count) mails retrouvés dans les index ; $($introuvables.Count) introuvables."
if ($introuvables.Count) { "Introuvables : " + ($introuvables -join ', ') }

# Documents cités par leur nom (documents indexés du même projet ; le plus récent si homonymes).
$docs = @"
from gestion_projets.actions a
join lateral (select d.id, d.nom from gestion_projets.documents d
  where d.projet_id = a.projet_id and d.present and length(d.nom) > 8 and position(lower(d.nom) in lower(a.source)) > 0
  order by d.nom, d.modifie_le desc nulls last) d on true
where a.source is not null
  and not exists (select 1 from gestion_projets.sources s where s.action_id = a.id and (s.document_id = d.id or s.objet = d.nom))
"@
if ($Simulation) {
  "$((& $sql -ReadOnly -Query "select count(distinct (a.id, d.nom)) n $docs" | ConvertFrom-Json)[0].n) documents cités à relier."
  return
}
$r = & $sql -Query "insert into gestion_projets.sources (action_id, type, objet, document_id, ajoute_par) select distinct on (a.id, d.nom) a.id, 'document', d.nom, d.id, 'systeme' $docs returning id" | ConvertFrom-Json
"$(@($r).Count) sources document ajoutées."
if (-not $valeurs.Count) { return }

$requete = @"
insert into gestion_projets.sources (action_id, type, date_source, expediteur, objet, mail_ref, numero, ajoute_par) values
$($valeurs -join ",`n")
on conflict (coalesce(action_id, echeance_id, livrable_id, periode_id, point_id, info_id), mail_ref) where mail_ref is not null do nothing
returning id
"@
$r = & $sql -Query $requete | ConvertFrom-Json
"$(@($r).Count) sources mail ajoutées."
