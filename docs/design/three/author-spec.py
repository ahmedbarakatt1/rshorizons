"""Reproducible subject-specific spec authoring after visual intake; never scores renders."""
import json, copy
from pathlib import Path

root=Path(__file__).resolve().parent
assessment=json.loads((root/"assessment.json").read_text(encoding="utf-8"))
spec=json.loads((root/"camera-sculpt-spec.json").read_text(encoding="utf-8"))
p=assessment["preSpecAssessment"]
p["objectClass"]={"primaryType":"underwater camera housing","primaryDomain":"object","formLanguage":["hard-surface","mechanical"],"structureKind":["compound object","layered shell"],"motionPotential":["whole-object transform","detachable"],"materialFamilies":["plastic","metal","rubber","glass-like"],"notes":"Original conceptual illustration. Rear construction is approximate."}
p["complexity"]["scores"]={"silhouetteComplexity":1,"componentCount":2,"hierarchyDepth":1,"repetitionDensity":1,"materialLayerCount":2,"localDetailDensity":1,"occlusionRisk":1,"actionReadinessNeed":1}
p["complexity"]["estimatedCounts"]={"macroComponents":3,"mesoComponents":4,"microFeatureGroups":3,"materialLayers":5,"repetitionSystems":2}
p["complexity"]["reasoning"]=["Rectangular housing, coaxial optical assembly and lateral rubber grip define the silhouette.","Two control caps and two repeated fastener systems require separate component hierarchy.","Hidden rear and underside are approximate; no engineering accuracy is claimed."]
p["specDepthDecision"]["needsRepetitionSystems"]=True
p["specDepthDecision"]["needsMaterialLocalOverrides"]=True
p["specDepthDecision"]["rationale"]="Visible flange, grip, controls, fasteners and shell seam must be represented independently."
p["unknownsToResolveBeforeImplementation"]=[]
p["resolvedApproximationNotes"]=["Rear panel is an explicit solid approximation accepted for the conceptual accent.","Absolute dimensions and waterproof internal construction are unknown; use relative units and make no physical claim."]
spec["preSpecAssessment"]=p
spec["localSpecSearch"]=assessment["localSpecSearch"]
spec["scores"]={"object_isolation":3,"silhouette_readability":3,"depth_inference":2,"primitive_decomposition":3,"material_procedurality":2,"occlusion_risk":1,"interaction_fit":3}
spec["qualityContract"]["definitionOfDone"]=["A compact navy rounded housing, turquoise circular flange, convex dark optical dome, asymmetric charcoal grip and two sand control caps read as the reference camera at three-quarter, front and side views.","Eight fasteners and a front panel seam remain visible in the review frame; rear is explicitly approximate.","Every pass must pass deterministic gates and recorded agent vision; feature stays disabled until runtime and accessibility checks pass."]
spec["qualityContract"]["minimumSpecDepth"].update({"macroComponents":3,"mesoComponents":4,"microFeatureGroups":2,"materialLayers":5,"repetitionSystems":2,"reviewViewpoints":4})
base=copy.deepcopy(spec["componentTree"][0])
def part(id,level,primitive,size,pos,material,parent="root",rotation=None,role="body"):
 c=copy.deepcopy(base)
 c.update(id=id,name=id.replace("-"," "),level=level,primitive=primitive,role=role,parent=parent,confidence=0.9,importance=0.9,material=material,materialLayers=[material],fidelityTier="structured")
 c["topologyClass"]="assembled-solid"
 c["topologyRationale"]="Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette."
 c["dimensions"]={"width":size[0],"height":size[1],"depth":size[2],"units":"relative","confidence":0.85}
 c["transform"]={"position":pos,"rotation":rotation or [0,0,0]}
 c["geometryDescriptor"]["edgeTreatment"]={"type":"bevel","bevelRadius":0.04,"segments":3}
 c["geometryDescriptor"]["topologyIntent"]="Closed solid with visible rounded rim."
 c["localFeatures"]=[{"id":id+"-form","type":"bevel","description":"Reference-observed silhouette and bevel.","edgeTreatment":{"type":"bevel","bevelRadius":0.04,"segments":3}}]
 c["actionProfile"]["animationRole"]="root" if parent is None else "rigid-part"
 c["actionProfile"]["destruction"]["fractureGroup"]=id
 c["actionProfile"]["destruction"]["debrisMaterial"]=material
 c["actionProfile"]["transformChannels"]["detach"]=parent is not None
 c["actionProfile"]["collider"]["notes"]="Coarse browser picking proxy only."
 c["surfaceDetail"].update(normalPattern="fine molded grain",notes="Solid-color concept with subtle micro relief; not a measured finish.")
 colors={"housing":("rgba(24,48,71,1)","plastic"),"turquoise":("rgba(33,174,187,1)","metal"),"rubber":("rgba(37,42,43,1)","rubber"),"glass":("rgba(13,32,37,1)","glass"),"sand":("rgba(183,171,145,1)","metal")}
 color,cls=colors[material]
 c["colorMaterialRecipe"]={"dominantAlbedo":color,"secondaryAlbedo":color,"materialClass":cls,"materialClassConfidence":0.85,"evidenceRefs":["full-object"],"notes":"Solid-color original conceptual reference."}
 if parent is not None:
  c["attachment"]={"parentId":parent,"parentSocket":id+"-seat","localStart":pos,"localEnd":pos,"contactType":"overlap","embedDepth":0.025,"overlap":0.025,"gapTolerance":0.01,"evidenceRefs":["full-object"]}
 return c
spec["componentTree"]=[
 part("root","macro","box",[2.6,1.7,0.7],[0,0,0],"housing",None),
 part("lens-mount","macro","cylinder",[1.42,0.2,1.42],[0,0,0.4],"turquoise",rotation=[1.57079632679,0,0]),
 part("grip","macro","box",[0.42,1.25,0.62],[1.39,-0.02,0],"rubber"),
 part("front-panel","meso","box",[2.48,1.58,0.05],[0,0,0.355],"housing"),
 part("glass-dome","meso","sphere",[1.08,1.08,0.38],[0,0,0.51],"glass"),
 part("control-main","macro","cylinder",[0.4,0.24,0.4],[-0.65,0.96,0],"sand",role="control"),
 part("control-secondary","macro","cylinder",[0.27,0.17,0.27],[0.03,0.93,0],"sand",role="control"),
 part("lens-sleeve","meso","cylinder",[1.15,0.15,1.15],[0,0,0.5],"rubber",rotation=[1.57079632679,0,0]),
 part("optical-collar","meso","torus",[1.13,1.13,0.05],[0,0,0.59],"rubber"),
 part("main-control-seat","meso","cylinder",[0.46,0.06,0.46],[-0.65,0.87,0],"housing"),
 part("secondary-control-seat","meso","cylinder",[0.33,0.06,0.33],[0.03,0.87,0],"housing"),
]
for group,coords,zpos,diameter in [("corner",[(x,y) for x in [-1.1,1.1] for y in [-0.65,0.65]],0.4,0.13),("lens",[(x,y) for x in [-0.43,0.43] for y in [-0.43,0.43]],0.53,0.105)]:
 for index,(x,y) in enumerate(coords):
  spec["componentTree"].append(part(group+"-fastener-"+str(index),"meso","cylinder",[diameter,0.04,diameter],[x,y,zpos],"sand",rotation=[1.57079632679,0,0]))
  spec["componentTree"].append(part(group+"-socket-"+str(index),"micro","cylinder",[diameter*0.42,0.012,diameter*0.42],[x,y,zpos+0.024],"rubber",rotation=[1.57079632679,0,0]))
spec["repetitionSystems"]=[
 {"id":"corner-screws","count":4,"elementComponentIds":["corner-fastener-"+str(i) for i in range(4)],"distribution":"four explicitly authored corners of front housing","evidenceRefs":["full-object"]},
 {"id":"lens-screws","count":4,"elementComponentIds":["lens-fastener-"+str(i) for i in range(4)],"distribution":"four explicitly authored diagonal flange quadrants","evidenceRefs":["full-object"]},
]
template=copy.deepcopy(spec["materials"][0])
spec["materials"]=[]
for mid,color,rough,metal in [("housing","#183047",0.65,0),("turquoise","#21aebb",0.29,0.6),("rubber","#252a2b",0.85,0),("glass","#0d2025",0.09,0.1),("sand","#b7ab91",0.34,0.8)]:
 m=copy.deepcopy(template);m.update(id=mid,name=mid,color=color,baseColor=color)
 m["albedo"]={"dominant":color,"secondary":[color],"samplingNotes":"Observed solid-color concept; exclude cast highlights."}
 m["colorVariation"].update(palette=[color],amplitude=0.015,pattern="fine-grain")
 m["roughness"].update(base=rough,variation=0.04)
 m["metalness"]["base"]=metal
 m["normal"].update(strength=0.025 if mid!="glass" else 0,scale=65)
 m["localOverrides"]=[{"id":mid+"-edge","region":"outer bevel","roughness":max(0.02,rough-0.08),"notes":"Edge reflection has lower roughness than recessed material."}]
 m["notes"]="Visual inference from conceptual reference. No exact inverse-rendering claim."
 report_path=root/"material-evidence"/(mid+"-report.json")
 if report_path.exists():
  r=json.loads(report_path.read_text(encoding="utf-8"))
  m["referencePbr"]={"version":"1.0","sourceImage":r["sourceImage"],"extractor":"stage1_intake/extract_pbr_evidence.py","method":"single-image pixel evidence, not photogrammetry","usable":r["ok"],"verdict":r["verdict"],"confidence":r["confidence"],"targetThreshold":0.7,"maps":r["maps"],"warnings":r["warnings"]}
 spec["materials"].append(m)
spec["preSpecAssessment"]["detailInventory"]={"scanMethod":"grid-3x3","targetMinDetails":9,"details":[]}
for i,(cid,kind,description) in enumerate([
 ("root","bevel","Rounded rectangular housing corners"),("lens-mount","bevel","Turquoise annular optical flange"),("grip","ridge","Asymmetric raised rubber grip"),
 ("front-panel","seam","Front panel perimeter"),("glass-dome","gloss","Dark convex glass highlight"),("control-main","ridge","Large top control sidewall"),
 ("control-secondary","bevel","Smaller top control cap"),("corner-fastener-0","fastener","Four recessed housing screws"),("lens-fastener-0","fastener","Four flange screws")]):
 spec["preSpecAssessment"]["detailInventory"]["details"].append({"id":"detail-"+str(i),"kind":kind,"description":description,"region":{"x":0,"y":0,"width":1,"height":1,"units":"normalized"},"scale":"object-relative","affects":"geometry" if kind!="gloss" else "material","mapsTo":{"type":"component.localFeatures","ref":cid+"/"+cid+"-form"},"evidenceRef":"full-object","confidence":0.9})
spec["viewEvidence"][0]["observations"]=["Rounded navy housing; turquoise coaxial front flange; dark optical dome; lateral grip; two top controls; two screw groups."]
spec["viewEvidence"][0]["confidence"]=0.95
spec["featureReviewTargets"]=[
 {"id":"housing-lens-silhouette","name":"Housing and front lens silhouette","tier":"critical","passIds":["blockout","structural-pass","form-refinement"],"minimumScore":0.8,"mustPass":True,"componentRefs":["root","lens-mount","glass-dome"],"evidenceRefs":["full-object"]},
 {"id":"grip-controls","name":"Asymmetric grip and paired top controls","tier":"critical","passIds":["blockout","structural-pass","form-refinement"],"minimumScore":0.8,"mustPass":True,"componentRefs":["grip","control-main","control-secondary"],"evidenceRefs":["full-object"]},
 {"id":"camera-surface","name":"Navy, turquoise, glass and sand material system","tier":"critical","passIds":["material-pass","surface-pass"],"minimumScore":0.75,"mustPass":True,"componentRefs":["root","lens-mount","glass-dome"],"evidenceRefs":["full-object"]},
]
spec["performanceBudget"].update(targetTriangles=6000,maxDrawCalls=30,textureSize=512,fpsTarget=30)
spec["referenceCamera"].update(aspect=1.5,fovDegrees=35,positionHint=[2,1.3,6],orientation={"yaw":0.22,"pitch":0.08,"roll":0})
spec["lightingFromPhoto"]=[{"type":"key light","position":[-3,5,4],"color":"#fff4df","intensity":3,"rendering":"ACES filmic tone mapping, exposure 1.0; soft ground shadow"},{"type":"fill light","position":[4,1,2],"color":"#dceef7","intensity":1.3},{"type":"rim light","position":[1,3,-3],"color":"#ffffff","intensity":2}]
(root/"camera-sculpt-spec.json").write_text(json.dumps(spec,indent=2)+"\n")
assessment["preSpecAssessment"]=spec["preSpecAssessment"];assessment["qualityContract"]=spec["qualityContract"]
(root/"assessment.json").write_text(json.dumps(assessment,indent=2)+"\n")
