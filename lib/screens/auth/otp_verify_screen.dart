import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../services/user_service.dart';
import '../home/customer_home.dart';
import '../home/delivery_home.dart';
import '../home/owner_home.dart';

class OtpVerifyScreen extends StatefulWidget {
  const OtpVerifyScreen({
    super.key,
    required this.verificationId,
    required this.role,
  });

  final String verificationId;
  final String role;

  @override
  State<OtpVerifyScreen> createState() => _OtpVerifyScreenState();
}

class _OtpVerifyScreenState extends State<OtpVerifyScreen> {
  final _codeController = TextEditingController();
  final _userService = UserService();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: widget.verificationId,
        smsCode: _codeController.text.trim(),
      );

      await FirebaseAuth.instance.signInWithCredential(credential);
      await _userService.syncRoleAccessAfterLogin(widget.role);

      if (widget.role == 'owner') {
        if (!mounted) return;
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const OwnerHomeScreen()),
          (_) => false,
        );
      } else if (widget.role == 'delivery') {
        if (!mounted) return;
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const DeliveryHomeScreen()),
          (_) => false,
        );
      } else {
        if (!mounted) return;
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const CustomerHomeScreen()),
          (_) => false,
        );
      }
    } on FirebaseAuthException catch (e) {
      if (mounted) {
        setState(() => _error = e.message ?? 'Verification failed');
      }
    } catch (e) {
      final message = e.toString().replaceFirst('Bad state: ', '');
      if (message == 'Contact admin') {
        await FirebaseAuth.instance.signOut();
      }
      if (mounted) {
        setState(() => _error = message.isEmpty ? 'Verification failed' : message);
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Verify OTP')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Text('Enter the 6-digit code sent to your phone.'),
            const SizedBox(height: 16),
            TextField(
              controller: _codeController,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(
                labelText: 'OTP',
                border: OutlineInputBorder(),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            const Spacer(),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _loading ? null : _verify,
                child: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Verify'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
