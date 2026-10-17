extends CharacterBody3D
class_name GameTikFighter

@export var move_speed: float = 4.2
@export var max_health: int = 100
@export var is_player: bool = false
var health: int
var blocking := false
var attack_cooldown := 0.0
var dodge_time := 0.0
var opponent: GameTikFighter
var defeated := false

func _ready() -> void:
    health = max_health
    if name == "Player":
        is_player = true

func _physics_process(delta: float) -> void:
    attack_cooldown = maxf(0.0, attack_cooldown - delta)
    dodge_time = maxf(0.0, dodge_time - delta)
    if defeated:
        velocity = Vector3.ZERO
        return
    if is_player:
        _player_control(delta)
    else:
        _simple_ai(delta)
    if not is_on_floor():
        velocity.y -= 22.0 * delta
    else:
        velocity.y = 0.0
    move_and_slide()

func _player_control(_delta: float) -> void:
    var input_dir := Vector2(
        float(Input.is_key_pressed(KEY_D)) - float(Input.is_key_pressed(KEY_A)),
        float(Input.is_key_pressed(KEY_S)) - float(Input.is_key_pressed(KEY_W))
    )
    var dir := Vector3(input_dir.x, 0, input_dir.y).normalized()
    velocity.x = dir.x * move_speed
    velocity.z = dir.z * move_speed
    blocking = Input.is_key_pressed(KEY_L)
    if Input.is_key_pressed(KEY_SPACE) and dodge_time <= 0.0:
        dodge_time = 0.45
        velocity.x = -global_position.x * 0.0 + (-1.0 if global_position.x > 0 else 1.0) * move_speed * 1.8
    if Input.is_key_pressed(KEY_J):
        attack(10, 0.45)
    if Input.is_key_pressed(KEY_K):
        attack(18, 0.8)

func _simple_ai(delta: float) -> void:
    if opponent == null or opponent.defeated:
        velocity.x = move_toward(velocity.x, 0.0, move_speed * delta)
        velocity.z = move_toward(velocity.z, 0.0, move_speed * delta)
        return
    var to_player := opponent.global_position - global_position
    to_player.y = 0
    if to_player.length() > 1.65:
        var dir := to_player.normalized()
        velocity.x = dir.x * move_speed * 0.72
        velocity.z = dir.z * move_speed * 0.72
    else:
        velocity.x = 0
        velocity.z = 0
        if attack_cooldown <= 0.0:
            attack(8, 1.0)

func attack(damage: int, cooldown: float) -> void:
    if attack_cooldown > 0.0 or defeated:
        return
    attack_cooldown = cooldown
    if opponent == null or opponent.defeated:
        return
    var distance := global_position.distance_to(opponent.global_position)
    if distance <= 2.1:
        opponent.take_damage(damage)

func take_damage(amount: int) -> void:
    if defeated:
        return
    var applied := int(ceil(float(amount) * (0.25 if blocking else 1.0)))
    health = maxi(0, health - applied)
    if health == 0:
        defeated = true
        set_physics_process(false)
        print(name, " defeated")
    else:
        print(name, " health: ", health)
