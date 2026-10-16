extends Node3D

@onready var player: GameTikFighter = $Player
@onready var enemy: GameTikFighter = $Enemy

func _ready() -> void:
    player.opponent = enemy
    enemy.opponent = player
    player.is_player = true
    enemy.is_player = false
    _add_arena_lighting()

func _add_arena_lighting() -> void:
    var light := DirectionalLight3D.new()
    light.rotation_degrees = Vector3(-55, -25, 0)
    light.light_energy = 1.4
    add_child(light)
    var camera := Camera3D.new()
    camera.position = Vector3(0, 6.5, 10)
    camera.look_at(Vector3.ZERO, Vector3.UP)
    camera.current = true
    add_child(camera)
