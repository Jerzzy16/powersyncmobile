import { useRouter } from "expo-router";
import { Keyboard, StatusBar, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";

export default function WorkoutScreen() {
    const router = useRouter();

    const lifts = [
        { name: "Squat", key: "squat" },
        { name: "Bench Press", key: "bench" },
        { name: "Deadlift", key: "deadlift" },
    ];

    const handleSelectLift = (liftKey: string) => {
        if (__DEV__) {
            console.log(`[Workout] Selected lift: ${liftKey}`);
        }
        router.push({ 
            pathname: "/vision-ondevice", 
            params: { lift: liftKey, ts: Date.now() } 
        });
    };
    return (
        <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
            <View className="flex-1 justify-center items-center p-4 bg-neutral-900">
                <StatusBar barStyle="light-content" backgroundColor="#171717" />
                <View className="w-full max-w-md">
                    <Text className="color-white text-2xl mb-6 text-center">
                        Choose Your Lift
                    </Text>
                    {lifts.map((lift) => (
                        <TouchableOpacity
                            key={lift.key}
                            onPress={() => handleSelectLift(lift.key)}
                            className="bg-lime-500 p-4 rounded-lg mb-4"
                        >
                            <Text className="text-black font-bold text-l text-center">{lift.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>
        </TouchableWithoutFeedback>
    );
}