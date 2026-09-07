using Godot;
namespace Duckov;

/// The player duck. Intents (move/aim/fire/reload/interact) are read from Input unless External is set (autopilot).
public partial class Player : CharacterBody3D, IDamageable
{
    public float Speed = 6.5f;
    public int Hp = 100, MaxHp = 100;
    public int Mag = 12, MagSize = 12, Reserve = 48;
    public float FireInterval = 0.16f;
    public float ReloadTime = 1.3f;
    public int Damage = 20;
    public float BulletSpeed = 45f;
    public float PickupRange = 2.2f;

    // intents
    public Vector2 MoveInput;          // world XZ
    public Vector3 AimPoint;           // world position to face/shoot at
    public bool FireHeld, ReloadPressed, InteractPressed;
    public bool External;

    public bool Dead { get; private set; }
    public float ReloadLeft { get; private set; }
    public bool Reloading => ReloadLeft > 0;
    public Loot NearbyLoot { get; private set; }
    public float HurtFlash { get; private set; }

    float _fireCd;
    float _yaw;
    DuckVisual _visual;

    public override void _Ready()
    {
        CollisionLayer = Layers.Player;
        CollisionMask = Layers.World | Layers.Enemy;
        AddChild(new CollisionShape3D { Shape = new CapsuleShape3D { Radius = 0.5f, Height = 1.6f }, Position = new Vector3(0, 0.8f, 0) });
        _visual = DuckVisual.Create(new Color(1f, 0.85f, 0.15f), new Color(0.35f, 0.25f, 0.15f), soldier: false);
        AddChild(_visual);
        AimPoint = GlobalPosition + new Vector3(0, 0.8f, -5f);
        _yaw = 0;
    }

    public override void _PhysicsProcess(double delta)
    {
        float dt = (float)delta;
        HurtFlash = Mathf.Max(0, HurtFlash - dt * 3f);
        var game = Game.I;
        if (Dead || game.Current != Game.State.Playing)
        {
            Velocity = Velocity.MoveToward(Vector3.Zero, 30f * dt);
            MoveAndSlide();
            _visual.Animate(0, dt);
            return;
        }
        if (!External) ReadInput();

        // movement
        var wish = new Vector3(MoveInput.X, 0, MoveInput.Y);
        if (wish.LengthSquared() > 1f) wish = wish.Normalized();
        var target = wish * Speed;
        var horiz = new Vector3(Velocity.X, 0, Velocity.Z).MoveToward(target, 40f * dt);
        Velocity = horiz;
        MoveAndSlide();
        GlobalPosition = new Vector3(GlobalPosition.X, 0, GlobalPosition.Z);

        // facing
        var d = AimPoint - GlobalPosition; d.Y = 0;
        if (d.LengthSquared() > 0.05f)
        {
            float t = Mathf.Atan2(-d.X, -d.Z);
            _yaw = Mathf.LerpAngle(_yaw, t, 1f - Mathf.Exp(-18f * dt));
            Rotation = new Vector3(0, _yaw, 0);
        }

        // reload
        if (ReloadLeft > 0)
        {
            ReloadLeft -= dt;
            if (ReloadLeft <= 0)
            {
                int n = Mathf.Min(MagSize - Mag, Reserve);
                Mag += n; Reserve -= n;
                ReloadLeft = 0;
            }
        }
        else if (ReloadPressed && Mag < MagSize && Reserve > 0)
        {
            ReloadLeft = ReloadTime;
        }

        // fire
        _fireCd -= dt;
        if (FireHeld && _fireCd <= 0 && !Reloading)
        {
            if (Mag > 0) Fire();
            else if (Reserve > 0) ReloadLeft = ReloadTime;
        }

        // loot proximity
        var nearest = game.FindNearestLoot(GlobalPosition, PickupRange);
        if (NearbyLoot != null && (!IsInstanceValid(NearbyLoot) || NearbyLoot.Collected)) NearbyLoot = null; // online: freed by the server's answer
        if (nearest != NearbyLoot)
        {
            NearbyLoot?.SetHighlighted(false);
            NearbyLoot = nearest;
            NearbyLoot?.SetHighlighted(true);
        }
        if (InteractPressed && NearbyLoot != null && !NearbyLoot.PendingNet)
        {
            var l = NearbyLoot;
            if (NetClient.I != null && NetClient.I.RequestPickup(l, GlobalPosition, _yaw)) { /* applied when the server answers `picked` */ }
            else { NearbyLoot = null; l.Pickup(this); }
        }

        _visual.Animate(Mathf.Clamp(horiz.Length() / Speed, 0, 1), dt);
        NetClient.I?.ReportMove(GlobalPosition, _yaw, dt);
        ReloadPressed = false; InteractPressed = false;
    }

    void ReadInput()
    {
        var v = Input.GetVector("move_left", "move_right", "move_forward", "move_back");
        MoveInput = v;
        FireHeld = Input.IsActionPressed("fire");
        if (Input.IsActionJustPressed("reload")) ReloadPressed = true;
        if (Input.IsActionJustPressed("interact")) InteractPressed = true;
        var cam = GetViewport().GetCamera3D();
        if (cam != null)
        {
            var mouse = GetViewport().GetMousePosition();
            var from = cam.ProjectRayOrigin(mouse);
            var dir = cam.ProjectRayNormal(mouse);
            var plane = new Plane(Vector3.Up, 0.8f);
            var hit = plane.IntersectsRay(from, dir);
            if (hit.HasValue) AimPoint = hit.Value;
        }
    }

    void Fire()
    {
        _fireCd = FireInterval;
        Mag--;
        var muzzle = _visual.Muzzle.GlobalPosition;
        var target = AimPoint; target.Y = muzzle.Y;
        var dir = target - muzzle;
        // if the aim point is behind/too close to the muzzle, shoot straight ahead
        var fwd = -GlobalTransform.Basis.Z;
        if (dir.LengthSquared() < 1f || dir.Normalized().Dot(fwd) < 0.3f) dir = fwd;
        dir = dir.Normalized();
        var b = new Bullet { Velocity = dir * BulletSpeed, Damage = Damage, HitMask = Layers.World | Layers.Enemy, FromPlayer = true, Shooter = this };
        Game.I.AddChild(b);
        b.GlobalPosition = muzzle;
        Fx.MuzzleFlash(Game.I, muzzle, dir);
        NetClient.I?.SendShot(muzzle, dir);
        Game.I.Cam?.Kick(0.06f);
        Game.I.OnPlayerShot(GlobalPosition);
    }

    public void Heal(int amount) { Hp = Mathf.Min(MaxHp, Hp + amount); NetClient.I?.SendHp(Hp); }
    public void AddReserve(int amount) { Reserve += amount; }

    public void TakeDamage(int amount, Vector3 fromPosition, bool fromPlayer)
    {
        if (Dead || fromPlayer) return;
        Hp -= amount;
        HurtFlash = 1f;
        _visual.Flash();
        Game.I.Cam?.Kick(0.25f);
        Game.I.Notify("player-hit");
        if (Hp <= 0)
        {
            Hp = 0;
            Dead = true;
            _visual.Fall();
            CollisionLayer = 0;
            Game.I.OnPlayerDied();
        }
        NetClient.I?.SendHp(Hp);
    }
}
