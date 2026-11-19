"""Run with Blender 5.2: blender --background --factory-startup --python scripts/export-character.py.

Export the artist's saved pose, including fingers and the in-hand weapon.
The source .blend is never modified.
"""
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(root / 'assets/character-military.blend'))
bpy.context.view_layer.update()

# Parent the independently placed weapon without changing its authored world transform.
gun = bpy.data.objects['topGun_low']
rig = bpy.data.objects['SWAT']
gun_world = gun.matrix_world.copy()
gun.parent = rig
gun.parent_type = 'BONE'
gun.parent_bone = 'mixamorig:RightHand'
bpy.context.view_layer.update()
gun.matrix_world = gun_world
bpy.context.view_layer.update()

for image in bpy.data.images:
    if image.size[0] > 2048:
        ratio = 2048 / image.size[0]
        image.scale(2048, round(image.size[1] * ratio))

bpy.ops.export_scene.gltf(
    filepath=str(root / 'assets/character-military.optimized.glb'),
    export_format='GLB',
    export_image_format='JPEG',
    export_jpeg_quality=85,
    export_animations=False,
    export_current_frame=True,
    export_rest_position_armature=False,
    export_cameras=False,
    export_lights=False,
)
