#include "GameTikFighterCharacter.h"
#include "Engine/World.h"
#include "DrawDebugHelpers.h"

AGameTikFighterCharacter::AGameTikFighterCharacter()
{
    PrimaryActorTick.bCanEverTick = true;
}

void AGameTikFighterCharacter::BeginPlay()
{
    Super::BeginPlay();
    Health = MaxHealth;
    OnHealthChanged(Health, MaxHealth);
}

void AGameTikFighterCharacter::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    AttackCooldownRemaining = FMath::Max(0.f, AttackCooldownRemaining - DeltaSeconds);
}

void AGameTikFighterCharacter::SetBlocking(bool bNewBlocking)
{
    bBlocking = bNewBlocking;
}

void AGameTikFighterCharacter::LightAttack()
{
    PerformAttack(LightDamage, 0.42f);
}

void AGameTikFighterCharacter::HeavyAttack()
{
    PerformAttack(HeavyDamage, 0.85f);
}

void AGameTikFighterCharacter::PerformAttack(float Damage, float Cooldown)
{
    if (AttackCooldownRemaining > 0.f || Health <= 0.f) return;
    AttackCooldownRemaining = Cooldown;
    const FVector Start = GetActorLocation() + FVector(0.f, 0.f, 60.f);
    const FVector End = Start + GetActorForwardVector() * AttackRange;
    FCollisionQueryParams Params(SCENE_QUERY_STAT(GameTikAttack), false, this);
    FHitResult Hit;
    if (GetWorld()->SweepSingleByChannel(Hit, Start, End, FQuat::Identity, ECC_Pawn,
        FCollisionShape::MakeSphere(55.f), Params))
    {
        if (AGameTikFighterCharacter* Target = Cast<AGameTikFighterCharacter>(Hit.GetActor()))
        {
            Target->ReceiveDamage(Damage);
        }
    }
}

void AGameTikFighterCharacter::ReceiveDamage(float Amount)
{
    if (Health <= 0.f) return;
    Health = FMath::Clamp(Health - (bBlocking ? Amount * 0.25f : Amount), 0.f, MaxHealth);
    OnHealthChanged(Health, MaxHealth);
    if (Health <= 0.f) OnKnockedOut();
}
