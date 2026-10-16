#pragma once
#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "GameTikFighterCharacter.generated.h"

UCLASS()
class GAMETIKARENA_API AGameTikFighterCharacter : public ACharacter
{
    GENERATED_BODY()
public:
    AGameTikFighterCharacter();
    virtual void Tick(float DeltaSeconds) override;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="GameTik|Combat") float MaxHealth = 100.f;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="GameTik|Combat") float Health = 100.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="GameTik|Combat") float LightDamage = 10.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="GameTik|Combat") float HeavyDamage = 20.f;
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="GameTik|Combat") float AttackRange = 180.f;
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="GameTik|Combat") bool bBlocking = false;
    UFUNCTION(BlueprintCallable, Category="GameTik|Combat") void SetBlocking(bool bNewBlocking);
    UFUNCTION(BlueprintCallable, Category="GameTik|Combat") void LightAttack();
    UFUNCTION(BlueprintCallable, Category="GameTik|Combat") void HeavyAttack();
    UFUNCTION(BlueprintCallable, Category="GameTik|Combat") void ReceiveDamage(float Amount);
    UFUNCTION(BlueprintImplementableEvent, Category="GameTik|Combat") void OnHealthChanged(float NewHealth, float InMaxHealth);
    UFUNCTION(BlueprintImplementableEvent, Category="GameTik|Combat") void OnKnockedOut();
protected:
    virtual void BeginPlay() override;
private:
    float AttackCooldownRemaining = 0.f;
    void PerformAttack(float Damage, float Cooldown);
};
